import { describe, expect, it } from "vitest";
import {
  contentAddressedKeySchema,
  conversionCallbackSchema,
  conversionManifestSchema,
  convertRequestSchema,
} from "./ingestion";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function validManifest() {
  return {
    sourceDocHash: HASH_A,
    pageCount: 2,
    theme: {
      colors: ["#1A2B3C", "#FFFFFF"],
      fonts: ["Calibri", "Arial"],
      logoCandidates: [`sha256/${HASH_C}.png`],
    },
    pages: [
      {
        n: 1,
        pngKey: `sha256/${HASH_B}.png`,
        thumbKey: `sha256/${HASH_C}.png`,
        text: "Slide one text",
        notes: "Speaker notes for slide one",
        embeddedImages: [
          { key: `sha256/${HASH_C}.jpeg`, width: 640, height: 480 },
        ],
      },
      {
        n: 2,
        pngKey: `sha256/${HASH_C}.png`,
        thumbKey: `sha256/${HASH_B}.png`,
        text: "",
        notes: "",
        embeddedImages: [],
      },
    ],
  };
}

describe("contentAddressedKeySchema", () => {
  it("accepts sha256/<hex>.<ext>", () => {
    expect(
      contentAddressedKeySchema.safeParse(`sha256/${HASH_A}.png`).success
    ).toBe(true);
  });

  it.each([
    ["missing prefix", `${HASH_A}.png`],
    ["short hash", "sha256/abc123.png"],
    ["uppercase hash", `sha256/${"A".repeat(64)}.png`],
    ["no extension", `sha256/${HASH_A}`],
    ["nested path", `uploads/sha256/${HASH_A}.png`],
  ])("rejects %s", (_label, key) => {
    expect(contentAddressedKeySchema.safeParse(key).success).toBe(false);
  });
});

describe("conversionManifestSchema", () => {
  it("accepts a valid manifest", () => {
    const result = conversionManifestSchema.safeParse(validManifest());
    expect(result.success).toBe(true);
  });

  it("accepts a null theme (pdf-native docs)", () => {
    const manifest = { ...validManifest(), theme: null };
    expect(conversionManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("rejects pageCount mismatched with pages length", () => {
    const manifest = { ...validManifest(), pageCount: 3 };
    const result = conversionManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "pageCount")).toBe(
        true
      );
    }
  });

  it("rejects duplicate page numbers", () => {
    const manifest = validManifest();
    manifest.pages[1].n = 1;
    expect(conversionManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects page numbers exceeding pageCount", () => {
    const manifest = validManifest();
    manifest.pages[1].n = 99;
    expect(conversionManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects non-content-addressed page keys", () => {
    const manifest = validManifest();
    manifest.pages[0].pngKey = "pages/1.png";
    expect(conversionManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects a malformed sourceDocHash", () => {
    const manifest = { ...validManifest(), sourceDocHash: "not-a-hash" };
    expect(conversionManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects unknown keys (strict contract)", () => {
    const manifest = { ...validManifest(), extra: true };
    expect(conversionManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects invalid theme colors", () => {
    const manifest = validManifest();
    manifest.theme.colors = ["blue"];
    expect(conversionManifestSchema.safeParse(manifest).success).toBe(false);
  });
});

describe("convertRequestSchema", () => {
  it("accepts a valid request", () => {
    const request = {
      jobId: "job-1",
      sourceKey: `sha256/${HASH_A}.pptx`,
      kind: "pptx",
      callbackUrl: "https://example.convex.site/converter/callback",
    };
    expect(convertRequestSchema.safeParse(request).success).toBe(true);
  });

  it("rejects unknown kinds", () => {
    const request = {
      jobId: "job-1",
      sourceKey: `sha256/${HASH_A}.docx`,
      kind: "docx",
      callbackUrl: "https://example.convex.site/converter/callback",
    };
    expect(convertRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe("conversionCallbackSchema", () => {
  it("accepts a jobId + manifest envelope", () => {
    const callback = { jobId: "job-1", manifest: validManifest() };
    expect(conversionCallbackSchema.safeParse(callback).success).toBe(true);
  });

  it("rejects a missing jobId", () => {
    const callback = { manifest: validManifest() };
    expect(conversionCallbackSchema.safeParse(callback).success).toBe(false);
  });
});
