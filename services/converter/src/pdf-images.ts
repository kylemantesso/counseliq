import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentAddressedKey, sha256Hex } from "./content-address";
import * as ffmpeg from "./ffmpeg";
import type { AssetStore } from "./media";
import { contentTypeForExt } from "./store";

const execFileAsync = promisify(execFile);

/**
 * PDF embedded-image extraction via poppler's pdfimages (M6, closing the M2
 * gap where only pptx decks yielded embedded images). Extraction is noisy,
 * so filtering is mandatory: a dimension floor and aspect cap drop
 * decoration slivers, SMask pairs are recombined into transparent PNGs
 * (best-effort), and an image repeating across many pages is routed to the
 * theme's logo candidates instead of being catalogued once per page.
 */

export interface PdfImageOptions {
  /** Images with a shorter edge under this are dropped (decoration floor). */
  minEdgePx: number;
  /** Images with edge ratio beyond this are dropped (slivers/gradients). */
  maxAspect: number;
  /** A hash on at least this many distinct pages is a logo candidate. */
  logoPageThreshold: number;
  /** Thumbnail longest edge. */
  thumbEdgePx: number;
}

export function loadPdfImageOptions(): PdfImageOptions {
  const num = (name: string, fallback: number) => {
    const raw = process.env[name];
    const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Environment variable ${name} must be a positive number`);
    }
    return value;
  };
  return {
    minEdgePx: num("PDF_IMAGE_MIN_PX", 200),
    maxAspect: num("PDF_IMAGE_MAX_ASPECT", 5),
    logoPageThreshold: num("PDF_LOGO_PAGE_THRESHOLD", 3),
    thumbEdgePx: num("THUMB_EDGE_PX", 480),
  };
}

export interface ListedImage {
  page: number;
  num: number;
  /** poppler types: image | smask | mask | stencil. */
  type: string;
  width: number;
  height: number;
  /** Encoding column (e.g. jpeg, image, ccitt) — drives the output ext. */
  enc: string;
}

/**
 * Parse `pdfimages -list` output. Only the first nine whitespace-delimited
 * columns are positional-stable (the object-ID column can be "[inline]"),
 * and we only need the first six of them.
 */
export function parsePdfImagesList(stdout: string): ListedImage[] {
  const rows: ListedImage[] = [];
  for (const line of stdout.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 9) continue;
    const [page, num, type, width, height, _color, _comp, _bpc, enc] = tokens;
    if (!/^\d+$/.test(page) || !/^\d+$/.test(num)) continue;
    rows.push({
      page: Number(page),
      num: Number(num),
      type,
      width: Number(width),
      height: Number(height),
      enc,
    });
  }
  return rows;
}

export interface SmaskPair {
  image: ListedImage;
  smask: ListedImage | null;
}

/**
 * Pair each image row with its soft mask. pdfimages lists an image's smask
 * immediately after the image row (same page), so pairing is by adjacency;
 * standalone mask/stencil rows are dropped.
 */
export function pairSmasks(rows: readonly ListedImage[]): SmaskPair[] {
  const pairs: SmaskPair[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.type !== "image") continue;
    const next = rows[i + 1];
    const smask =
      next !== undefined && next.type === "smask" && next.page === row.page
        ? next
        : null;
    pairs.push({ image: row, smask });
  }
  return pairs;
}

/** Dimension floor + aspect cap. Filters BEFORE any file is read. */
export function passesImageFilter(
  image: { width: number; height: number },
  options: Pick<PdfImageOptions, "minEdgePx" | "maxAspect">
): boolean {
  const shortEdge = Math.min(image.width, image.height);
  const longEdge = Math.max(image.width, image.height);
  if (shortEdge < options.minEdgePx) return false;
  if (longEdge / shortEdge > options.maxAspect) return false;
  return true;
}

export interface DedupedImage<T> {
  representative: T;
  pageNs: number[];
}

/**
 * Group per-page occurrences by content hash and split repeats: a hash on
 * `logoPageThreshold`+ distinct pages is a logo candidate (one copy), the
 * rest are catalogue images carrying every page they appear on.
 */
export function routeRepeats<T>(
  occurrences: ReadonlyArray<{ hash: string; page: number; item: T }>,
  logoPageThreshold: number
): { catalogue: DedupedImage<T>[]; logos: T[] } {
  const byHash = new Map<string, { item: T; pages: Set<number> }>();
  for (const occurrence of occurrences) {
    const existing = byHash.get(occurrence.hash);
    if (existing) {
      existing.pages.add(occurrence.page);
    } else {
      byHash.set(occurrence.hash, {
        item: occurrence.item,
        pages: new Set([occurrence.page]),
      });
    }
  }
  const catalogue: DedupedImage<T>[] = [];
  const logos: T[] = [];
  for (const { item, pages } of byHash.values()) {
    if (pages.size >= logoPageThreshold) {
      logos.push(item);
    } else {
      catalogue.push({
        representative: item,
        pageNs: [...pages].sort((a, b) => a - b),
      });
    }
  }
  return { catalogue, logos };
}

export interface ExtractedPdfImage {
  pageNs: number[];
  key: string;
  thumbKey: string;
  width: number;
  height: number;
}

export interface PdfImageExtraction {
  images: ExtractedPdfImage[];
  logoCandidates: string[];
}

interface ReadyImage {
  bytes: Buffer;
  ext: "png" | "jpg";
  width: number;
  height: number;
}

/** Read one listed row's file (-png -j naming), best-effort SMask merge. */
async function readImageFile(
  dir: string,
  prefix: string,
  row: ListedImage
): Promise<{ bytes: Buffer; ext: "png" | "jpg" } | null> {
  const pad = (value: number) => String(value).padStart(3, "0");
  for (const ext of row.enc === "jpeg" ? (["jpg", "png"] as const) : (["png", "jpg"] as const)) {
    try {
      const bytes = await readFile(
        join(dir, `${prefix}-${pad(row.page)}-${pad(row.num)}.${ext}`)
      );
      return { bytes, ext };
    } catch {
      // Try the other extension; some encodings fall back to png.
    }
  }
  return null;
}

/**
 * Full extraction: list → filter → extract files → merge smasks → dedupe/
 * route repeats → thumbnail + upload. Content-addressed and idempotent.
 */
export async function extractPdfImages(
  pdf: Buffer,
  store: AssetStore,
  options: PdfImageOptions
): Promise<PdfImageExtraction> {
  const dir = await mkdtemp(join(tmpdir(), "converter-pdfimages-"));
  try {
    const pdfPath = join(dir, "input.pdf");
    await writeFile(pdfPath, pdf);

    const { stdout } = await execFileAsync("pdfimages", ["-list", pdfPath]);
    const rows = parsePdfImagesList(stdout);
    const pairs = pairSmasks(rows).filter((pair) =>
      passesImageFilter(pair.image, options)
    );
    if (pairs.length === 0) return { images: [], logoCandidates: [] };

    // -png -j keeps jpeg streams as .jpg and everything else as .png, with
    // -p page-numbered filenames matching the -list rows.
    await execFileAsync("pdfimages", [
      "-png",
      "-j",
      "-p",
      pdfPath,
      join(dir, "img"),
    ]);

    const occurrences: Array<{ hash: string; page: number; item: ReadyImage }> = [];
    for (const pair of pairs) {
      const base = await readImageFile(dir, "img", pair.image);
      if (!base) continue;
      let ready: ReadyImage = {
        bytes: base.bytes,
        ext: base.ext,
        width: pair.image.width,
        height: pair.image.height,
      };
      if (pair.smask) {
        const mask = await readImageFile(dir, "img", pair.smask);
        if (mask) {
          try {
            const merged = await ffmpeg.alphaMerge(
              base.bytes,
              base.ext,
              mask.bytes,
              mask.ext
            );
            ready = { ...ready, bytes: merged, ext: "png" };
          } catch {
            // Best-effort: keep the unmasked base image.
          }
        }
      }
      occurrences.push({
        hash: sha256Hex(ready.bytes),
        page: pair.image.page,
        item: ready,
      });
    }

    const { catalogue, logos } = routeRepeats(
      occurrences,
      options.logoPageThreshold
    );

    const images: ExtractedPdfImage[] = [];
    for (const entry of catalogue) {
      const image = entry.representative;
      const key = contentAddressedKey(image.bytes, image.ext);
      const thumbBytes = await ffmpeg.resizeImage(
        image.bytes,
        image.ext,
        options.thumbEdgePx,
        image.ext
      );
      const thumbKey = contentAddressedKey(thumbBytes, image.ext);
      await store.uploadIfAbsent(key, image.bytes, contentTypeForExt(image.ext));
      await store.uploadIfAbsent(
        thumbKey,
        thumbBytes,
        contentTypeForExt(image.ext)
      );
      images.push({
        pageNs: entry.pageNs,
        key,
        thumbKey,
        width: image.width,
        height: image.height,
      });
    }

    const logoCandidates: string[] = [];
    for (const logo of logos) {
      const key = contentAddressedKey(logo.bytes, logo.ext);
      await store.uploadIfAbsent(key, logo.bytes, contentTypeForExt(logo.ext));
      logoCandidates.push(key);
    }

    return { images, logoCandidates: [...new Set(logoCandidates)] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** True when poppler's pdfimages is on PATH (gates the real-binary tests). */
export async function pdfimagesAvailable(): Promise<boolean> {
  try {
    await execFileAsync("pdfimages", ["-v"]);
    return true;
  } catch {
    return false;
  }
}
