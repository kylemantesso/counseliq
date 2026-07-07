import { imageSize } from "image-size";
import {
  conversionManifestSchema,
  type ConversionManifest,
  type ConvertRequest,
  type ManifestPage,
} from "@counseliq/course-schema";
import { contentAddressedKey, sha256Hex } from "./content-address";
import { signBody, SIGNATURE_HEADER } from "./hmac";
import { extractPdfText, renderPdfPages } from "./pdf";
import { extractPptx, type PptxExtraction } from "./pptx";
import { pptxToPdf } from "./soffice";
import { contentTypeForExt, type ObjectStore } from "./store";

/** Raster formats we can measure and usefully hand downstream. */
const RASTER_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

interface PageArtifacts {
  n: number;
  pngKey: string;
  thumbKey: string;
  text: string;
  notes: string;
  embeddedImages: { key: string; width: number; height: number }[];
}

/** Pure manifest assembly — kept separate so tests can validate the output shape. */
export function buildManifest(input: {
  sourceDocHash: string;
  theme: ConversionManifest["theme"];
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
    theme: input.theme,
    pages,
  };
  // Converter-side validation of the shared contract before it leaves here.
  return conversionManifestSchema.parse(manifest);
}

async function uploadImage(
  store: ObjectStore,
  bytes: Buffer,
  ext: string
): Promise<{ key: string; width: number; height: number } | null> {
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
  return { key, width: dims.width, height: dims.height };
}

export async function runConversion(
  request: ConvertRequest,
  store: ObjectStore
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

  // Map pptx zip image paths to uploaded content-addressed keys as we go,
  // so theme logo candidates can reference them.
  const keyByZipPath = new Map<string, string>();

  const pages: PageArtifacts[] = [];
  for (const page of rendered) {
    const pngKey = contentAddressedKey(page.png, "png");
    const thumbKey = contentAddressedKey(page.thumb, "png");
    await store.uploadIfAbsent(pngKey, page.png, "image/png");
    await store.uploadIfAbsent(thumbKey, page.thumb, "image/png");

    const slide = pptx?.slides.find((s) => s.n === page.n);
    const embeddedImages: PageArtifacts["embeddedImages"] = [];
    for (const image of slide?.images ?? []) {
      const uploaded = await uploadImage(store, image.bytes, image.ext);
      if (uploaded) {
        keyByZipPath.set(image.zipPath, uploaded.key);
        embeddedImages.push(uploaded);
      }
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

  let theme: ConversionManifest["theme"] = null;
  if (pptx) {
    const logoCandidates: string[] = [];
    for (const zipPath of pptx.theme.logoCandidateZipPaths) {
      let key = keyByZipPath.get(zipPath);
      if (!key) {
        const image = pptx.images.find((i) => i.zipPath === zipPath);
        if (image) {
          const uploaded = await uploadImage(store, image.bytes, image.ext);
          if (uploaded) key = uploaded.key;
        }
      }
      if (key) logoCandidates.push(key);
    }
    theme = {
      method: "ooxml",
      colors: pptx.theme.colors,
      fonts: pptx.theme.fonts,
      logoCandidates: [...new Set(logoCandidates)],
    };
  }

  return buildManifest({ sourceDocHash, theme, pages });
}

/** POSTs the HMAC-signed manifest back to Convex, with bounded retries. */
export async function deliverCallback(
  callbackUrl: string,
  jobId: string,
  manifest: ConversionManifest,
  secret: string
): Promise<void> {
  const body = JSON.stringify({ jobId, manifest });
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
