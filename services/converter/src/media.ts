import JSZip from "jszip";
import { imageSize } from "image-size";
import {
  assetIngestManifestSchema,
  type AssetIngestManifest,
  type AssetIngestRequest,
  type AssetManifestEntry,
} from "@counseliq/course-schema";
import type { MediaCaps } from "./config";
import { contentAddressedKey } from "./content-address";
import * as ffmpeg from "./ffmpeg";
import type { MediaProbe } from "./ffmpeg";
import { contentTypeForExt } from "./store";

/** The slice of ObjectStore this module needs (tests use an in-memory map). */
export interface AssetStore {
  download(key: string): Promise<Buffer>;
  uploadIfAbsent(
    key: string,
    bytes: Uint8Array,
    contentType: string
  ): Promise<void>;
}

/**
 * Asset ingestion (M6): images are normalised (capped longest edge) with a
 * thumbnail; videos are probed, transcoded to muted H.264 MP4, and get a
 * poster frame (which doubles as their thumbnail). Zips expand server-side
 * into per-entry results. Every input yields exactly one manifest entry —
 * accepted or rejected-with-reason — and all artifacts are content-
 * addressed, so re-posting a job re-emits the same manifest without
 * re-uploading anything.
 */

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "webm", "avi"]);

export type AssetFileKind = "image" | "video" | "zip";

export function classifyByExtension(name: string): AssetFileKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (ext === "zip") return "zip";
  return null;
}

/** Zip entries we never treat as assets (macOS metadata, hidden files). */
export function isJunkZipEntry(path: string): boolean {
  const segments = path.split("/");
  return segments.some(
    (segment) => segment === "__MACOSX" || segment.startsWith(".")
  );
}

/** Cap check that needs no probe — applies to every file including zips. */
export function sizeRejection(byteLength: number, caps: MediaCaps): string | null {
  const maxBytes = caps.maxFileMb * 1024 * 1024;
  if (byteLength > maxBytes) {
    return `file is ${(byteLength / 1024 / 1024).toFixed(1)}MB — over the ${caps.maxFileMb}MB cap`;
  }
  return null;
}

/** Probe-based video rejection: absurd inputs never reach the transcoder. */
export function videoRejection(probe: MediaProbe, caps: MediaCaps): string | null {
  if (!probe.hasVideoStream || probe.width <= 0 || probe.height <= 0) {
    return "no decodable video stream";
  }
  if (probe.durationMs > caps.maxVideoSeconds * 1000) {
    return `video is ${Math.round(probe.durationMs / 1000)}s — over the ${caps.maxVideoSeconds}s cap`;
  }
  return null;
}

/** Normalised output extension for an accepted image. */
export function imageOutputExt(sourceExt: string): "jpg" | "png" {
  // png keeps transparency; everything else re-encodes to jpg. Animated
  // gif/webp collapse to a deterministic first frame either way.
  return sourceExt === "png" ? "png" : "jpg";
}

function rejected(
  sourceKey: string,
  originalName: string,
  reason: string
): AssetManifestEntry {
  return { status: "rejected", sourceKey, originalName, reason };
}

interface FileToProcess {
  sourceKey: string;
  originalName: string;
  bytes: Buffer;
}

async function processImage(
  store: AssetStore,
  file: FileToProcess,
  caps: MediaCaps
): Promise<AssetManifestEntry> {
  const ext = file.originalName.split(".").pop()?.toLowerCase() ?? "";
  let dims: { width?: number; height?: number };
  try {
    dims = imageSize(file.bytes);
  } catch {
    return rejected(file.sourceKey, file.originalName, "undecodable image");
  }
  if (!dims.width || !dims.height) {
    return rejected(file.sourceKey, file.originalName, "undecodable image");
  }

  const outExt = imageOutputExt(ext);
  const needsReencode =
    Math.max(dims.width, dims.height) > caps.maxImageEdgePx ||
    ext === "gif" ||
    ext === "webp";
  let outBytes = file.bytes;
  let width = dims.width;
  let height = dims.height;
  if (needsReencode) {
    outBytes = await ffmpeg.resizeImage(file.bytes, ext, caps.maxImageEdgePx, outExt);
    const outDims = imageSize(outBytes);
    width = outDims.width ?? width;
    height = outDims.height ?? height;
  }
  const thumbBytes = await ffmpeg.resizeImage(
    outBytes,
    outExt,
    caps.thumbEdgePx,
    outExt
  );

  const objectKey = contentAddressedKey(outBytes, outExt);
  const thumbKey = contentAddressedKey(thumbBytes, outExt);
  await store.uploadIfAbsent(objectKey, outBytes, contentTypeForExt(outExt));
  await store.uploadIfAbsent(thumbKey, thumbBytes, contentTypeForExt(outExt));

  return {
    status: "accepted",
    sourceKey: file.sourceKey,
    originalName: file.originalName,
    kind: "image",
    objectKey,
    thumbKey,
    width,
    height,
  };
}

async function processVideo(
  store: AssetStore,
  file: FileToProcess,
  caps: MediaCaps
): Promise<AssetManifestEntry> {
  const ext = file.originalName.split(".").pop()?.toLowerCase() ?? "";
  let probe: MediaProbe;
  try {
    probe = await ffmpeg.probeMedia(file.bytes, ext);
  } catch {
    return rejected(file.sourceKey, file.originalName, "undecodable video");
  }
  const reason = videoRejection(probe, caps);
  if (reason) return rejected(file.sourceKey, file.originalName, reason);

  const transcoded = await ffmpeg.transcodeVideo(
    file.bytes,
    ext,
    caps.maxVideoEdgePx
  );
  const outProbe = await ffmpeg.probeMedia(transcoded, "mp4");
  const poster = await ffmpeg.extractPoster(transcoded, "mp4", caps.posterEdgePx);

  const objectKey = contentAddressedKey(transcoded, "mp4");
  const thumbKey = contentAddressedKey(poster, "jpg");
  await store.uploadIfAbsent(objectKey, transcoded, "video/mp4");
  await store.uploadIfAbsent(thumbKey, poster, "image/jpeg");

  return {
    status: "accepted",
    sourceKey: file.sourceKey,
    originalName: file.originalName,
    kind: "video",
    objectKey,
    thumbKey,
    width: outProbe.width,
    height: outProbe.height,
    durationMs: Math.max(1, outProbe.durationMs),
  };
}

async function processOne(
  store: AssetStore,
  file: FileToProcess,
  caps: MediaCaps
): Promise<AssetManifestEntry[]> {
  const kind = classifyByExtension(file.originalName);
  if (kind === null) {
    return [
      rejected(
        file.sourceKey,
        file.originalName,
        "unsupported file type (images, video, or zip only)"
      ),
    ];
  }
  const sizeReason = sizeRejection(file.bytes.byteLength, caps);
  if (sizeReason) {
    return [rejected(file.sourceKey, file.originalName, sizeReason)];
  }
  if (kind === "zip") {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file.bytes);
    } catch {
      return [rejected(file.sourceKey, file.originalName, "unreadable zip")];
    }
    const entries: AssetManifestEntry[] = [];
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || isJunkZipEntry(entry.name)) continue;
      const bytes = Buffer.from(await entry.async("uint8array"));
      const nested = await processOne(
        store,
        {
          sourceKey: file.sourceKey,
          originalName: `${file.originalName}/${entry.name}`,
          bytes,
        },
        caps
      );
      entries.push(...nested);
    }
    if (entries.length === 0) {
      return [
        rejected(file.sourceKey, file.originalName, "zip contains no media files"),
      ];
    }
    return entries;
  }
  return kind === "image"
    ? [await processImage(store, file, caps)]
    : [await processVideo(store, file, caps)];
}

export async function runAssetIngest(
  request: AssetIngestRequest,
  store: AssetStore,
  caps: MediaCaps
): Promise<AssetIngestManifest> {
  const entries: AssetManifestEntry[] = [];
  for (const file of request.files) {
    let bytes: Buffer;
    try {
      bytes = await store.download(file.sourceKey);
    } catch {
      entries.push(
        rejected(file.sourceKey, file.originalName, "source object not found")
      );
      continue;
    }
    entries.push(
      ...(await processOne(
        store,
        { sourceKey: file.sourceKey, originalName: file.originalName, bytes },
        caps
      ))
    );
  }
  // Converter-side validation of the shared contract before it leaves here.
  return assetIngestManifestSchema.parse({ files: entries });
}
