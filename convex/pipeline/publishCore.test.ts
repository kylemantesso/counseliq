import type { UnitTiming } from "@counseliq/course-schema";
import { describe, expect, test } from "vitest";
import {
  buildPublishManifest,
  buildUnitDefinitionHash,
  collectArtifactKeys,
  computeSpecHash,
  publishPreconditionViolations,
  type BuildPublishManifestInput,
  type PublishUnitRow,
} from "./publishCore";

/** Deterministic fake sha256 for pure tests: stable, hex-ish, input-keyed. */
function fakeSha256(input: string): string {
  let hash = 7;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(64, "0");
}

function makeTiming(overrides?: Partial<UnitTiming>): UnitTiming {
  return {
    version: 3,
    unitKey: "mu-101",
    provider: "mock",
    voiceRef: "latrobe-narrator-01",
    model: "mock-tts-1",
    unitAudioKey: "sha256/unit-audio.mp3",
    totalDurationMs: 9000,
    sentences: [
      {
        narrationId: "n1",
        speakText: "First sentence spoken aloud.",
        startMs: 0,
        durationMs: 4000,
        words: [{ text: "First", startMs: 0, endMs: 400 }],
      },
      {
        narrationId: "n2",
        speakText: "Second sentence follows on.",
        startMs: 4250,
        durationMs: 4750,
        words: [{ text: "Second", startMs: 4250, endMs: 4700 }],
      },
    ],
    cardBeats: [{ cardIndex: 0, atMs: 0 }],
    media: [],
    generatedAt: 1751884800000,
    ...overrides,
  };
}

function makeManifestInput(): BuildPublishManifestInput {
  return {
    definition: {
      courseId: "latrobe-health-101",
      brandRef: "latrobe",
      language: "en-AU",
      voice: {
        provider: "mock",
        voiceRef: "latrobe-narrator-01",
        pronunciationLexicon: { Bundoora: "bun-DOOR-ah" },
      },
    },
    courseVersion: 1,
    specHash: "feedface",
    exportKey: "sha256/feedface.json",
    runId: "run-1",
    institutionName: "La Trobe University",
    themeSource: "institution",
    themeTokens: { primaryColor: "#e2231a" },
    promptVersions: { "author-unit": "author-unit@1" },
    publishedAtIso: "2026-07-07T12:00:00.000Z",
    units: [
      {
        unitId: "mu-101",
        moduleId: "m1",
        unitDefinitionHash: "cafe0001",
        timing: makeTiming(),
        unitAudioKey: "sha256/unit-101.mp3",
        timingKey: "sha256/t101.json",
        assetRefs: ["asset-1", "asset-2"],
      },
      {
        unitId: "mu-102",
        moduleId: "m1",
        unitDefinitionHash: "cafe0002",
        timing: makeTiming({
          unitKey: "mu-102",
          sentences: [
            {
              narrationId: "n1",
              speakText: "Third sentence for unit two.",
              startMs: 0,
              durationMs: 3000,
              words: [{ text: "Third", startMs: 0, endMs: 350 }],
            },
          ],
        }),
        unitAudioKey: "sha256/unit-102.mp3",
        timingKey: "sha256/t102.json",
        assetRefs: ["asset-1"],
      },
    ],
    assets: {
      "asset-1": {
        assetRef: "asset-1",
        kind: "image",
        objectKey: "sha256/img1.png",
        thumbKey: "sha256/img1-thumb.jpg",
        width: 1600,
        height: 900,
        aspect: "landscape",
      },
      "asset-2": {
        assetRef: "asset-2",
        kind: "video",
        objectKey: "sha256/vid2.mp4",
        thumbKey: "sha256/vid2-poster.jpg",
        width: 1080,
        height: 1920,
        aspect: "portrait",
        durationMs: 6800,
      },
    },
  };
}

function makeUnitRow(overrides?: Partial<PublishUnitRow>): PublishUnitRow {
  return {
    unitKey: "mu-101",
    state: "assets_ready",
    timing: makeTiming(),
    narration: [
      { id: "n1", text: "First sentence." },
      { id: "n2", text: "Second sentence." },
    ],
    ...overrides,
  };
}

describe("hashes", () => {
  test("computeSpecHash and buildUnitDefinitionHash are deterministic", () => {
    expect(computeSpecHash("{}", fakeSha256)).toBe(computeSpecHash("{}", fakeSha256));
    expect(buildUnitDefinitionHash({ a: 1 }, fakeSha256)).toBe(
      buildUnitDefinitionHash({ a: 1 }, fakeSha256)
    );
    expect(computeSpecHash("{}", fakeSha256)).not.toBe(computeSpecHash("{ }", fakeSha256));
  });
});

describe("publishPreconditionViolations", () => {
  test("clean units produce no violations", () => {
    expect(publishPreconditionViolations([makeUnitRow()])).toEqual([]);
  });

  test("a blocked unit is named with its state", () => {
    const violations = publishPreconditionViolations([
      makeUnitRow({ unitKey: "mu-bad", state: "blocked" }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("mu-bad");
    expect(violations[0]).toContain("blocked");
  });

  test("a unit with an error is rejected", () => {
    const violations = publishPreconditionViolations([
      makeUnitRow({ error: { retryable: true, cause: "provider 500" } }),
    ]);
    expect(violations.some((violation) => violation.includes("provider 500"))).toBe(true);
  });

  test("missing timing is rejected", () => {
    const violations = publishPreconditionViolations([makeUnitRow({ timing: undefined })]);
    expect(violations.some((violation) => violation.includes("missing timing"))).toBe(true);
  });

  test("a stale timing version is rejected", () => {
    const timing = { ...makeTiming(), version: 0 as unknown as 1 };
    const violations = publishPreconditionViolations([makeUnitRow({ timing })]);
    expect(violations.some((violation) => violation.includes("version 0"))).toBe(true);
  });

  test("a narration sentence without a timing entry is rejected", () => {
    const violations = publishPreconditionViolations([
      makeUnitRow({
        narration: [
          { id: "n1", text: "First." },
          { id: "n2", text: "Second." },
          { id: "n3", text: "Third, never synthesised." },
        ],
      }),
    ]);
    expect(violations.some((violation) => violation.includes('"n3"'))).toBe(true);
  });
});

describe("buildPublishManifest", () => {
  test("assembles a valid manifest deterministically", () => {
    const first = buildPublishManifest(makeManifestInput());
    const second = buildPublishManifest(makeManifestInput());
    expect(first.manifest).toEqual(second.manifest);
    expect(first.warnings).toEqual([]);
  });

  test("artifactKeys contains every audio + timing + media key + exportKey once", () => {
    const { manifest } = buildPublishManifest(makeManifestInput());
    const keys = collectArtifactKeys(manifest);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("sha256/feedface.json");
    expect(keys).toContain("sha256/unit-101.mp3");
    expect(keys).toContain("sha256/unit-102.mp3");
    expect(keys).toContain("sha256/t101.json");
    expect(keys).toContain("sha256/t102.json");
    expect(keys).toContain("sha256/img1.png");
    expect(keys).toContain("sha256/img1-thumb.jpg");
    expect(keys).toContain("sha256/vid2.mp4");
    expect(keys).toContain("sha256/vid2-poster.jpg");
    expect(keys).toHaveLength(9);
  });

  test("manifest voice is the synthesis voice, with a warning on divergence", () => {
    const input = makeManifestInput();
    input.definition.voice.voiceRef = "narrator-01";
    const { manifest, warnings } = buildPublishManifest(input);
    expect(manifest.voice.voiceRef).toBe("latrobe-narrator-01");
    expect(warnings.some((warning) => warning.includes("voice mismatch"))).toBe(true);
  });

  test("sentence characters come from speakText length", () => {
    const { manifest } = buildPublishManifest(makeManifestInput());
    expect(manifest.units[0].audio.sentences[0].characters).toBe(
      "First sentence spoken aloud.".length
    );
  });

  test("publishes continuous unit audio as a verified artifact", () => {
    const input = makeManifestInput();
    input.units[0].unitAudioKey = "sha256/unit-audio.mp3";
    const { manifest } = buildPublishManifest(input);
    expect(manifest.units[0].audio.unitAudioKey).toBe("sha256/unit-audio.mp3");
    expect(manifest.artifactKeys).toContain("sha256/unit-audio.mp3");
  });

  test("an invalid assembly throws (self-validation)", () => {
    const input = makeManifestInput();
    input.units[1].unitId = input.units[0].unitId;
    expect(() => buildPublishManifest(input)).toThrow();
  });

  test("no units throws", () => {
    const input = makeManifestInput();
    input.units = [];
    expect(() => buildPublishManifest(input)).toThrow("no units");
  });

  test("a referenced assetRef missing from the frozen asset map throws", () => {
    const input = makeManifestInput();
    input.units[0].assetRefs.push("asset-missing");
    expect(() => buildPublishManifest(input)).toThrow("asset-missing");
  });
});
