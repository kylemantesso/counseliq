import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { OBJECT_KEY_PATTERN } from "@counseliq/course-schema";
import type { MediaCaps } from "../src/config";
import { contentAddressedKey } from "../src/content-address";
import { ffmpegAvailable, probeMedia } from "../src/ffmpeg";
import {
  classifyByExtension,
  imageOutputExt,
  isJunkZipEntry,
  runAssetIngest,
  sizeRejection,
  videoRejection,
  type AssetStore,
} from "../src/media";

const CAPS: MediaCaps = {
  maxVideoSeconds: 60,
  maxFileMb: 500,
  maxVideoEdgePx: 1920,
  maxImageEdgePx: 2560,
  thumbEdgePx: 480,
  posterEdgePx: 960,
};

const FIXTURES = join(
  __dirname,
  "../../../packages/course-schema/fixtures/media"
);

/** In-memory AssetStore: seeded with sources, records every upload. */
function memoryStore(seed: Record<string, Buffer>): AssetStore & {
  uploads: Map<string, Buffer>;
} {
  const objects = new Map(Object.entries(seed));
  const uploads = new Map<string, Buffer>();
  return {
    uploads,
    async download(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error(`missing object ${key}`);
      return bytes;
    },
    async uploadIfAbsent(key, bytes, _contentType) {
      if (!objects.has(key)) {
        const buffer = Buffer.from(bytes);
        objects.set(key, buffer);
        uploads.set(key, buffer);
      }
    },
  };
}

async function fixture(name: string): Promise<Buffer> {
  return readFile(join(FIXTURES, name));
}

describe("pure classification and caps", () => {
  test("classifyByExtension", () => {
    expect(classifyByExtension("photo.JPG")).toBe("image");
    expect(classifyByExtension("a/b/clip.mov")).toBe("video");
    expect(classifyByExtension("pack.zip")).toBe("zip");
    expect(classifyByExtension("deck.pptx")).toBeNull();
    expect(classifyByExtension("noext")).toBeNull();
  });

  test("isJunkZipEntry", () => {
    expect(isJunkZipEntry("__MACOSX/._photo.jpg")).toBe(true);
    expect(isJunkZipEntry(".hidden.txt")).toBe(true);
    expect(isJunkZipEntry("campus/.DS_Store")).toBe(true);
    expect(isJunkZipEntry("campus/quad.jpg")).toBe(false);
  });

  test("sizeRejection enforces the MB cap", () => {
    expect(sizeRejection(10 * 1024 * 1024, CAPS)).toBeNull();
    expect(sizeRejection(501 * 1024 * 1024, CAPS)).toMatch(/over the 500MB cap/);
  });

  test("videoRejection enforces stream + duration caps", () => {
    const base = {
      durationMs: 5000,
      width: 1280,
      height: 720,
      hasVideoStream: true,
      hasAudioStream: true,
      codec: "h264",
    };
    expect(videoRejection(base, CAPS)).toBeNull();
    expect(videoRejection({ ...base, hasVideoStream: false }, CAPS)).toMatch(
      /no decodable video stream/
    );
    expect(videoRejection({ ...base, durationMs: 61000 }, CAPS)).toMatch(
      /over the 60s cap/
    );
  });

  test("imageOutputExt keeps png, jpg-ifies the rest", () => {
    expect(imageOutputExt("png")).toBe("png");
    expect(imageOutputExt("jpg")).toBe("jpg");
    expect(imageOutputExt("webp")).toBe("jpg");
  });
});

describe("runAssetIngest rejection paths (no binaries needed)", () => {
  test("unsupported type, missing source, unreadable zip each reject with a reason", async () => {
    const docBytes = Buffer.from("not media");
    const docKey = contentAddressedKey(docBytes, "docx");
    const badZipBytes = Buffer.from("definitely not a zip");
    const badZipKey = contentAddressedKey(badZipBytes, "zip");
    const missingKey = `sha256/${"0".repeat(64)}.jpg`;
    const store = memoryStore({ [docKey]: docBytes, [badZipKey]: badZipBytes });

    const manifest = await runAssetIngest(
      {
        jobId: "job1",
        callbackUrl: "https://example.test/cb",
        files: [
          { sourceKey: docKey, originalName: "brochure.docx" },
          { sourceKey: missingKey, originalName: "gone.jpg" },
          { sourceKey: badZipKey, originalName: "broken.zip" },
        ],
      },
      store,
      CAPS
    );

    expect(manifest.files).toHaveLength(3);
    const reasons = manifest.files.map((f) =>
      f.status === "rejected" ? f.reason : "ACCEPTED"
    );
    expect(reasons[0]).toMatch(/unsupported file type/);
    expect(reasons[1]).toMatch(/source object not found/);
    expect(reasons[2]).toMatch(/unreadable zip/);
    expect(store.uploads.size).toBe(0);
  });

  test("oversize file rejects before any decode", async () => {
    const bigBytes = Buffer.alloc(2 * 1024 * 1024, 7);
    const bigKey = contentAddressedKey(bigBytes, "mp4");
    const store = memoryStore({ [bigKey]: bigBytes });
    const manifest = await runAssetIngest(
      {
        jobId: "job2",
        callbackUrl: "https://example.test/cb",
        files: [{ sourceKey: bigKey, originalName: "huge.mp4" }],
      },
      store,
      { ...CAPS, maxFileMb: 1 }
    );
    const entry = manifest.files[0];
    expect(entry.status).toBe("rejected");
    if (entry.status === "rejected") {
      expect(entry.reason).toMatch(/over the 1MB cap/);
    }
  });
});

describe.skipIf(!(await ffmpegAvailable()))("runAssetIngest with ffmpeg", () => {
  test("image: accepted with thumbnail, content-addressed, idempotent", async () => {
    const bytes = await fixture("photo.jpg");
    const sourceKey = contentAddressedKey(bytes, "jpg");
    const store = memoryStore({ [sourceKey]: bytes });
    const request = {
      jobId: "img1",
      callbackUrl: "https://example.test/cb",
      files: [{ sourceKey, originalName: "photo.jpg" }],
    };

    const manifest = await runAssetIngest(request, store, CAPS);
    const entry = manifest.files[0];
    expect(entry.status).toBe("accepted");
    if (entry.status !== "accepted") return;
    expect(entry.kind).toBe("image");
    expect(entry.width).toBe(640);
    expect(entry.height).toBe(360);
    expect(entry.objectKey).toMatch(OBJECT_KEY_PATTERN);
    expect(entry.thumbKey).toMatch(OBJECT_KEY_PATTERN);
    expect(entry.durationMs).toBeUndefined();

    // Idempotent: same job re-run emits the same manifest, uploads nothing new.
    const uploadsAfterFirst = store.uploads.size;
    const again = await runAssetIngest(request, store, CAPS);
    expect(again).toEqual(manifest);
    expect(store.uploads.size).toBe(uploadsAfterFirst);
  });

  test("oversized image is re-encoded down to the edge cap", async () => {
    const bytes = await fixture("wide-huge.jpg"); // 3200x1800
    const sourceKey = contentAddressedKey(bytes, "jpg");
    const store = memoryStore({ [sourceKey]: bytes });
    const manifest = await runAssetIngest(
      {
        jobId: "img2",
        callbackUrl: "https://example.test/cb",
        files: [{ sourceKey, originalName: "wide-huge.jpg" }],
      },
      store,
      CAPS
    );
    const entry = manifest.files[0];
    expect(entry.status).toBe("accepted");
    if (entry.status !== "accepted") return;
    expect(Math.max(entry.width, entry.height)).toBeLessThanOrEqual(2560);
  });

  test("video: transcoded muted mp4 with poster; source audio stripped", async () => {
    const bytes = await fixture("clip-2s.mp4"); // has an AAC track
    expect((await probeMedia(bytes, "mp4")).hasAudioStream).toBe(true);
    const sourceKey = contentAddressedKey(bytes, "mp4");
    const store = memoryStore({ [sourceKey]: bytes });

    const manifest = await runAssetIngest(
      {
        jobId: "vid1",
        callbackUrl: "https://example.test/cb",
        files: [{ sourceKey, originalName: "clip-2s.mp4" }],
      },
      store,
      CAPS
    );
    const entry = manifest.files[0];
    expect(entry.status).toBe("accepted");
    if (entry.status !== "accepted") return;
    expect(entry.kind).toBe("video");
    expect(entry.durationMs).toBeGreaterThan(1500);
    expect(entry.durationMs).toBeLessThan(3000);

    const transcoded = store.uploads.get(entry.objectKey);
    expect(transcoded).toBeDefined();
    const outProbe = await probeMedia(transcoded as Buffer, "mp4");
    expect(outProbe.hasAudioStream).toBe(false); // -an is mechanical
    expect(outProbe.hasVideoStream).toBe(true);
    expect(outProbe.codec).toBe("h264");
    expect(store.uploads.get(entry.thumbKey)).toBeDefined();
  });

  test("video over the duration cap is rejected", async () => {
    const bytes = await fixture("clip-90s.mp4");
    const sourceKey = contentAddressedKey(bytes, "mp4");
    const store = memoryStore({ [sourceKey]: bytes });
    const manifest = await runAssetIngest(
      {
        jobId: "vid2",
        callbackUrl: "https://example.test/cb",
        files: [{ sourceKey, originalName: "clip-90s.mp4" }],
      },
      store,
      CAPS
    );
    const entry = manifest.files[0];
    expect(entry.status).toBe("rejected");
    if (entry.status === "rejected") {
      expect(entry.reason).toMatch(/over the 60s cap/);
    }
    expect(store.uploads.size).toBe(0);
  });

  test("zip expands to per-entry results; junk entries skipped", async () => {
    const clean = await fixture("pack.zip");
    const junky = await fixture("pack-with-junk.zip");
    const cleanKey = contentAddressedKey(clean, "zip");
    const junkyKey = contentAddressedKey(junky, "zip");
    const store = memoryStore({ [cleanKey]: clean, [junkyKey]: junky });

    const manifest = await runAssetIngest(
      {
        jobId: "zip1",
        callbackUrl: "https://example.test/cb",
        files: [
          { sourceKey: cleanKey, originalName: "pack.zip" },
          { sourceKey: junkyKey, originalName: "pack-with-junk.zip" },
        ],
      },
      store,
      CAPS
    );

    const names = manifest.files.map((f) => f.originalName);
    expect(names).toContain("pack.zip/photo.jpg");
    expect(names).toContain("pack.zip/clip-2s.mp4");
    expect(names).toContain("pack-with-junk.zip/photo.jpg");
    expect(names.some((n) => n.includes("__MACOSX"))).toBe(false);
    expect(names.some((n) => n.includes(".hidden"))).toBe(false);
    // Zip entries keep the zip's sourceKey so callbacks trace to the upload.
    for (const entry of manifest.files) {
      expect([cleanKey, junkyKey]).toContain(entry.sourceKey);
    }
  });
});
