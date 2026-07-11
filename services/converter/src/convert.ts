import { imageSize } from "image-size";
import {
  conversionManifestSchema,
  type ConversionManifest,
  type ConvertRequest,
  type ManifestPage,
} from "@counseliq/course-schema";
import { contentAddressedKey, sha256Hex } from "./content-address";
import * as ffmpeg from "./ffmpeg";
import { signBody, SIGNATURE_HEADER } from "./hmac";
import { extractPdfText, renderPdfPages } from "./pdf";
import {
  extractPdfImages,
  type PdfImageOptions,
} from "./pdf-images";
import { extractPptx, type PptxExtraction } from "./pptx";
import { pptxToPdf } from "./soffice";
import { contentTypeForExt, type ObjectStore } from "./store";

/** Raster formats we can measure and usefully hand downstream. */
const RASTER_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

export interface ConversionMediaOptions {
  /** Embedded-image thumbnail longest edge. */
  thumbEdgePx: number;
  pdfImages: PdfImageOptions;
}

interface PageArtifacts {
  n: number;
  pngKey: string;
  thumbKey: string;
  text: string;
  notes: string;
  embeddedImages: {
    key: string;
    width: number;
    height: number;
    thumbKey?: string;
  }[];
}

/** Pure manifest assembly — kept separate so tests can validate the output shape. */
export function buildManifest(input: {
  sourceDocHash: string;
  pages: PageArtifacts[];
}): ConversionManifest {
  const pages: ManifestPage[] = input.pages.map((page) => ({
    n: page.n,
    pngKey: page.pngKey,
    thumbKey: page.thumbKey,
    text: page.text,
    notes: page.notes,
    embeddedImages: page.embeddedImages,
  }));
  const manifest = {
    sourceDocHash: input.sourceDocHash,
    pageCount: pages.length,
    pages,
  };
  // Converter-side validation of the shared contract before it leaves here.
  return conversionManifestSchema.parse(manifest);
}

async function uploadImage(
  store: ObjectStore,
  bytes: Buffer,
  ext: string,
  thumbEdgePx?: number
): Promise<{ key: string; width: number; height: number; thumbKey?: string } | null> {
  if (!RASTER_EXTS.has(ext)) return null;
  let dims: { width?: number; height?: number };
  try {
    dims = imageSize(bytes);
  } catch {
    return null;
  }
  if (!dims.width || !dims.height) return null;
  const key = contentAddressedKey(bytes, ext);
  await store.uploadIfAbsent(key, bytes, contentTypeForExt(ext));

  let thumbKey: string | undefined;
  if (thumbEdgePx !== undefined) {
    try {
      const outExt = ext === "png" ? "png" : "jpg";
      const thumbBytes = await ffmpeg.resizeImage(bytes, ext, thumbEdgePx, outExt);
      thumbKey = contentAddressedKey(thumbBytes, outExt);
      await store.uploadIfAbsent(thumbKey, thumbBytes, contentTypeForExt(outExt));
    } catch {
      // Thumbnail is best-effort; the full image still catalogues.
    }
  }
  return {
    key,
    width: dims.width,
    height: dims.height,
    ...(thumbKey !== undefined ? { thumbKey } : {}),
  };
}

export async function runConversion(
  request: ConvertRequest,
  store: ObjectStore,
  media: ConversionMediaOptions
): Promise<ConversionManifest> {
  const sourceBytes = await store.download(request.sourceKey);
  const sourceDocHash = sha256Hex(sourceBytes);

  let pptx: PptxExtraction | null = null;
  let pdf: Buffer;
  if (request.kind === "pptx") {
    pptx = await extractPptx(sourceBytes);
    pdf = await pptxToPdf(sourceBytes);
  } else {
    pdf = sourceBytes;
  }

  const rendered = await renderPdfPages(pdf);
  const pdfTexts = pptx ? null : await extractPdfText(pdf);

  // pdf-native docs: pull embedded images via pdfimages (filtered, deduped,
  // repeats routed to logo candidates) — closes the M2 pptx-only gap.
  const pdfEmbedded = pptx
    ? null
    : await extractPdfImages(pdf, store, media.pdfImages);

  const pages: PageArtifacts[] = [];
  for (const page of rendered) {
    const pngKey = contentAddressedKey(page.png, "png");
    const thumbKey = contentAddressedKey(page.thumb, "png");
    await store.uploadIfAbsent(pngKey, page.png, "image/png");
    await store.uploadIfAbsent(thumbKey, page.thumb, "image/png");

    const slide = pptx?.slides.find((s) => s.n === page.n);
    const embeddedImages: PageArtifacts["embeddedImages"] = [];
    for (const image of slide?.images ?? []) {
      const uploaded = await uploadImage(
        store,
        image.bytes,
        image.ext,
        media.thumbEdgePx
      );
      if (uploaded) {
        embeddedImages.push(uploaded);
      }
    }
    for (const image of pdfEmbedded?.images ?? []) {
      if (!image.pageNs.includes(page.n)) continue;
      embeddedImages.push({
        key: image.key,
        width: image.width,
        height: image.height,
        thumbKey: image.thumbKey,
      });
    }

    pages.push({
      n: page.n,
      pngKey,
      thumbKey,
      text: slide?.text ?? pdfTexts?.[page.n - 1] ?? "",
      notes: slide?.notes ?? "",
      embeddedImages,
    });
  }

  return buildManifest({ sourceDocHash, pages });
}

/** POSTs an HMAC-signed callback body back to Convex, with bounded retries. */
export async function deliverCallback(
  callbackUrl: string,
  payload: Record<string, unknown>,
  secret: string
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signBody(body, secret);

  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: signature,
        },
        body,
      });
      if (response.ok) return;
      // 4xx means the manifest was rejected — retrying won't help.
      if (response.status >= 400 && response.status < 500) {
        throw new Error(
          `Callback rejected with ${response.status}: ${await response.text()}`
        );
      }
      lastError = new Error(`Callback failed with ${response.status}`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Callback rejected")
      ) {
        throw error;
      }
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Callback delivery failed");
}
