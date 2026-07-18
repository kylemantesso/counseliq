import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  PUBLISH_MANIFEST_SCHEMA_REF,
  PublishManifestParseError,
  parsePublishManifest,
  publishManifestSchema,
} from "./publish-manifest";

const exampleJson = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/publish-manifest-example.json"), "utf8")
) as Record<string, unknown>;

function cloneExample(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(exampleJson)) as Record<string, unknown>;
}

describe("publishManifestSchema", () => {
  test("the example fixture parses clean", () => {
    const manifest = parsePublishManifest(exampleJson);
    expect(manifest.$schema).toBe(PUBLISH_MANIFEST_SCHEMA_REF);
    expect(manifest.units).toHaveLength(2);
    expect(manifest.artifactKeys).toContain(manifest.exportKey);
    expect(Object.keys(manifest.assets).length).toBeGreaterThan(0);
  });

  test("a dangling unit audio artifact reference fails", () => {
    const broken = cloneExample();
    (broken.artifactKeys as string[]) = (broken.artifactKeys as string[]).filter(
      (key) => !key.includes("0101")
    );
    const result = publishManifestSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".").includes("unitAudioKey"))).toBe(true);
    }
  });

  test("a dangling timingKey fails", () => {
    const broken = cloneExample();
    (broken.units as Array<{ timingKey: string }>)[0].timingKey =
      "sha256/9999999999999999999999999999999999999999999999999999999999999999.json";
    expect(() => parsePublishManifest(broken)).toThrow(PublishManifestParseError);
  });

  test("a missing exportKey entry fails", () => {
    const broken = cloneExample();
    (broken.artifactKeys as string[]) = (broken.artifactKeys as string[]).filter(
      (key) => !key.endsWith("abcdef01.json")
    );
    const result = publishManifestSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "exportKey")).toBe(true);
    }
  });

  test("the wrong $schema is rejected", () => {
    const broken = cloneExample();
    broken.$schema = "counseliq://publish-manifest/v0";
    expect(() => parsePublishManifest(broken)).toThrow(PublishManifestParseError);
  });

  test("duplicate unit ids are rejected", () => {
    const broken = cloneExample();
    const units = broken.units as Array<{ unitId: string }>;
    units[1].unitId = units[0].unitId;
    const result = publishManifestSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("duplicate unitId"))).toBe(true);
    }
  });

  test("duplicate artifactKeys entries are rejected", () => {
    const broken = cloneExample();
    const keys = broken.artifactKeys as string[];
    keys.push(keys[0]);
    const result = publishManifestSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("duplicates"))).toBe(true);
    }
  });

  test("a unit assetRef must exist in the manifest asset map", () => {
    const broken = cloneExample();
    (broken.units as Array<{ assetRefs: string[] }>)[0].assetRefs.push("missing-ref");
    const result = publishManifestSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("missing from assets"))).toBe(true);
    }
  });

  test("asset object bytes must appear in artifactKeys", () => {
    const broken = cloneExample();
    const assets = broken.assets as Record<string, { objectKey: string }>;
    const missing = assets[Object.keys(assets)[0]].objectKey;
    (broken.artifactKeys as string[]) = (broken.artifactKeys as string[]).filter((key) => key !== missing);
    const result = publishManifestSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("objectKey"))).toBe(true);
    }
  });

  test("the parse error collects every issue with readable paths", () => {
    const broken = cloneExample();
    broken.$schema = "nope";
    broken.courseVersion = 0;
    try {
      parsePublishManifest(broken);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PublishManifestParseError);
      const parseError = error as PublishManifestParseError;
      expect(parseError.issues.length).toBeGreaterThanOrEqual(2);
      expect(parseError.message).toContain("courseVersion");
    }
  });

  test("unknown keys are rejected (strict)", () => {
    const broken = cloneExample();
    broken.extraneous = true;
    expect(() => parsePublishManifest(broken)).toThrow(PublishManifestParseError);
  });
});
