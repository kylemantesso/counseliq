import { describe, expect, test } from "vitest";
import {
  TIMING_VERSION,
  unitScriptSchema,
  unitTimingSchema,
} from "./timing";
import type { UnitScript, UnitTiming } from "./timing";

const validScript: UnitScript = {
  version: 1,
  normalizerVersion: "normalize@1",
  generatedAt: 1780000000000,
  sentences: [
    {
      narrationId: "n1",
      sourceText: "La Trobe invested A$82M in the building.",
      speakText: "La Trobe invested eighty-two million Australian dollars in the building.",
      alignment: [
        { origStart: 0, origEnd: 17, normStart: 0, normEnd: 17, kind: "copy" },
        { origStart: 17, origEnd: 22, normStart: 17, normEnd: 62, kind: "expand" },
        { origStart: 22, origEnd: 40, normStart: 62, normEnd: 80, kind: "copy" },
      ],
      blockedTerms: [],
    },
  ],
};

const validTiming: UnitTiming = {
  version: TIMING_VERSION,
  unitKey: "mu-101",
  provider: "elevenlabs",
  voiceRef: "latrobe-narrator-01",
  model: "eleven_multilingual_v2",
  interSentenceGapMs: 250,
  totalDurationMs: 4200,
  generatedAt: 1780000000000,
  sentences: [
    {
      narrationId: "n1",
      speakText: "La Trobe trains nurses on campus.",
      audioKey: "sha256/abc123.mp3",
      startMs: 0,
      durationMs: 4200,
      words: [
        { text: "La", startMs: 0, endMs: 180 },
        { text: "Trobe", startMs: 180, endMs: 520 },
        { text: "trains", startMs: 560, endMs: 940 },
        { text: "nurses", startMs: 980, endMs: 1400 },
        { text: "on", startMs: 1450, endMs: 1560 },
        { text: "campus.", startMs: 1600, endMs: 2200 },
      ],
    },
  ],
  cardBeats: [{ cardIndex: 0, atMs: 980 }],
};

describe("unitScriptSchema", () => {
  test("valid script parses", () => {
    expect(unitScriptSchema.parse(validScript)).toEqual(validScript);
  });

  test("wrong version is rejected", () => {
    expect(unitScriptSchema.safeParse({ ...validScript, version: 2 }).success).toBe(false);
  });

  test("unknown keys are rejected (strict)", () => {
    expect(unitScriptSchema.safeParse({ ...validScript, extra: true }).success).toBe(false);
  });

  test("empty sentences rejected", () => {
    expect(unitScriptSchema.safeParse({ ...validScript, sentences: [] }).success).toBe(false);
  });
});

describe("unitTimingSchema", () => {
  test("valid timing parses", () => {
    expect(unitTimingSchema.parse(validTiming)).toEqual(validTiming);
  });

  test("wrong version is rejected", () => {
    expect(unitTimingSchema.safeParse({ ...validTiming, version: 99 }).success).toBe(false);
  });

  test("negative times are rejected", () => {
    const bad = structuredClone(validTiming);
    bad.sentences[0].words[0].startMs = -1;
    expect(unitTimingSchema.safeParse(bad).success).toBe(false);
  });

  test("non-integer times are rejected", () => {
    const bad = structuredClone(validTiming);
    bad.sentences[0].startMs = 12.5;
    expect(unitTimingSchema.safeParse(bad).success).toBe(false);
  });

  test("unknown keys are rejected (strict)", () => {
    expect(unitTimingSchema.safeParse({ ...validTiming, debug: {} }).success).toBe(false);
  });

  test("empty words rejected", () => {
    const bad = structuredClone(validTiming);
    bad.sentences[0].words = [];
    expect(unitTimingSchema.safeParse(bad).success).toBe(false);
  });
});
