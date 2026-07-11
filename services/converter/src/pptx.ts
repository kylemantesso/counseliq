import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { sha256Hex } from "./content-address";

/**
 * Best-effort pptx (OOXML) extraction: per-slide text runs and speaker
 * notes, and embedded images.
 */

export interface PptxImage {
  /** Path inside the pptx zip, e.g. ppt/media/image1.png */
  zipPath: string;
  bytes: Buffer;
  ext: string;
}

export interface PptxSlide {
  /** 1-based slide number in presentation order. */
  n: number;
  text: string;
  notes: string;
  images: PptxImage[];
}

export interface PptxExtraction {
  slides: PptxSlide[];
  /** All embedded images across the deck, deduplicated by content hash. */
  images: PptxImage[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Text nodes: keep as-is (a:t values).
  trimValues: false,
  parseTagValue: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Collects visible text from a DrawingML text body (p:txBody / a:txBody). */
function textFromTxBody(txBody: unknown): string {
  const paragraphs = asArray((txBody as Record<string, unknown>)?.["a:p"]);
  const lines: string[] = [];
  for (const p of paragraphs) {
    const runs = asArray((p as Record<string, unknown>)?.["a:r"]);
    const parts: string[] = [];
    for (const r of runs) {
      const t = (r as Record<string, unknown>)?.["a:t"];
      if (typeof t === "string") parts.push(t);
      else if (typeof t === "number") parts.push(String(t));
    }
    // Field runs (slide numbers, dates) also carry a:t.
    const fields = asArray((p as Record<string, unknown>)?.["a:fld"]);
    for (const f of fields) {
      const t = (f as Record<string, unknown>)?.["a:t"];
      if (typeof t === "string") parts.push(t);
    }
    const line = parts.join("").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

/** Recursively finds all text bodies (p:txBody) under a shape tree node. */
function collectTextBodies(node: unknown, out: unknown[]): void {
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "p:txBody" || key === "a:txBody") {
      for (const body of asArray(value)) out.push(body);
    } else if (typeof value === "object" && value !== null) {
      for (const child of asArray(value)) collectTextBodies(child, out);
    }
  }
}

function textFromSlideXml(xml: string): string {
  const doc = parser.parse(xml);
  const bodies: unknown[] = [];
  collectTextBodies(doc, bodies);
  return bodies
    .map((b) => textFromTxBody(b))
    .filter((t) => t.length > 0)
    .join("\n");
}

interface Relationship {
  id: string;
  type: string;
  target: string;
}

function parseRels(xml: string): Relationship[] {
  const doc = parser.parse(xml);
  const rels = asArray(doc?.Relationships?.Relationship);
  return rels.map((r: Record<string, unknown>) => ({
    id: String(r["@_Id"]),
    type: String(r["@_Type"]),
    target: String(r["@_Target"]),
  }));
}

/** Resolves a relationship target relative to a base directory in the zip. */
function resolveZipPath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = [...baseDir.split("/"), ...target.split("/")];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
}

async function readEntry(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  return entry.async("string");
}

/** Slide zip paths in presentation order (p:sldIdLst r:id order). */
async function orderedSlidePaths(zip: JSZip): Promise<string[]> {
  const presentationXml = await readEntry(zip, "ppt/presentation.xml");
  const relsXml = await readEntry(zip, "ppt/_rels/presentation.xml.rels");
  if (presentationXml && relsXml) {
    const rels = parseRels(relsXml);
    const byId = new Map(rels.map((r) => [r.id, r]));
    const doc = parser.parse(presentationXml);
    const slideIds = asArray(
      doc?.["p:presentation"]?.["p:sldIdLst"]?.["p:sldId"]
    );
    const paths: string[] = [];
    for (const sldId of slideIds) {
      const rid = (sldId as Record<string, unknown>)["@_r:id"];
      const rel = byId.get(String(rid));
      if (rel) paths.push(resolveZipPath("ppt", rel.target));
    }
    if (paths.length > 0) return paths;
  }
  // Fallback: numeric filename order.
  return Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });
}

function extFromZipPath(zipPath: string): string {
  const ext = zipPath.split(".").pop() ?? "bin";
  return ext.toLowerCase();
}

async function imagesFromRels(
  zip: JSZip,
  rels: Relationship[],
  baseDir: string
): Promise<PptxImage[]> {
  const images: PptxImage[] = [];
  for (const rel of rels) {
    if (!rel.type.endsWith("/image")) continue;
    const zipPath = resolveZipPath(baseDir, rel.target);
    const entry = zip.file(zipPath);
    if (!entry) continue;
    const bytes = await entry.async("nodebuffer");
    images.push({ zipPath, bytes, ext: extFromZipPath(zipPath) });
  }
  return images;
}

export async function extractPptx(bytes: Buffer): Promise<PptxExtraction> {
  const zip = await JSZip.loadAsync(bytes);
  const slidePaths = await orderedSlidePaths(zip);

  const slides: PptxSlide[] = [];
  const imagesByHash = new Map<string, PptxImage>();

  for (const [slideIndex, slidePath] of slidePaths.entries()) {
    const slideXml = await readEntry(zip, slidePath);
    if (!slideXml) continue;

    const slideDir = slidePath.split("/").slice(0, -1).join("/");
    const slideFile = slidePath.split("/").pop()!;
    const relsXml = await readEntry(zip, `${slideDir}/_rels/${slideFile}.rels`);
    const rels = relsXml ? parseRels(relsXml) : [];

    // Speaker notes via the notesSlide relationship.
    let notes = "";
    const notesRel = rels.find((r) => r.type.endsWith("/notesSlide"));
    if (notesRel) {
      const notesXml = await readEntry(
        zip,
        resolveZipPath(slideDir, notesRel.target)
      );
      if (notesXml) notes = textFromSlideXml(notesXml);
    }

    const slideImages = await imagesFromRels(zip, rels, slideDir);
    for (const image of slideImages) {
      const hash = sha256Hex(image.bytes);
      if (!imagesByHash.has(hash)) imagesByHash.set(hash, image);
    }

    slides.push({
      n: slideIndex + 1,
      text: textFromSlideXml(slideXml),
      notes,
      images: slideImages,
    });
  }

  return {
    slides,
    images: [...imagesByHash.values()],
  };
}
