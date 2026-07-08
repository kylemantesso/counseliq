import { unitTimingSchema, type UnitTiming } from "@counseliq/course-schema";
import { describe, expect, test } from "vitest";
import {
  BEAT_BASE_MS,
  BEAT_STAGGER_MS,
  beatsRevealedAt,
  clampClock,
  deriveActiveCard,
  deriveActiveSentence,
} from "../src/timeline";

/**
 * Synthetic artifact: two sentences with a 250ms gap, three card beats.
 * Parsed through unitTimingSchema so the fixture can never drift from the
 * real contract.
 */
const FIXTURE: UnitTiming = unitTimingSchema.parse({
  version: 2,
  unitKey: "mu-101",
  provider: "mock",
  voiceRef: "test-narrator",
  model: "mock-model",
  interSentenceGapMs: 250,
  totalDurationMs: 5250,
  sentences: [
    {
      narrationId: "n1",
      speakText: "Welcome to the course",
      audioKey: "sha256/aaa.mp3",
      startMs: 0,
      durationMs: 2000,
      words: [
        { text: "Welcome", startMs: 0, endMs: 400 },
        { text: "to", startMs: 400, endMs: 550 },
        { text: "the", startMs: 550, endMs: 700 },
        { text: "course", startMs: 700, endMs: 2000 },
      ],
    },
    {
      narrationId: "n2",
      speakText: "It has three parts",
      audioKey: "sha256/bbb.mp3",
      startMs: 2250,
      durationMs: 3000,
      words: [
        { text: "It", startMs: 2250, endMs: 2500 },
        { text: "has", startMs: 2500, endMs: 2900 },
        { text: "three", startMs: 2900, endMs: 3400 },
        { text: "parts", startMs: 3400, endMs: 5250 },
      ],
    },
  ],
  cardBeats: [
    { cardIndex: 0, atMs: 0 },
    { cardIndex: 1, atMs: 700 },
    { cardIndex: 2, atMs: 2900 },
  ],
  media: [],
  generatedAt: 1720000000000,
});

describe("clampClock", () => {
  test("clamps into [0, totalDurationMs]", () => {
    expect(clampClock(FIXTURE, -100)).toBe(0);
    expect(clampClock(FIXTURE, 3000)).toBe(3000);
    expect(clampClock(FIXTURE, 999999)).toBe(5250);
  });
});

describe("deriveActiveCard", () => {
  test("no card active before the first beat", () => {
    const noEarlyBeats: UnitTiming = { ...FIXTURE, cardBeats: [{ cardIndex: 0, atMs: 500 }] };
    const { cardIndex, timing } = deriveActiveCard(noEarlyBeats, 100);
    expect(cardIndex).toBeNull();
    expect(timing.beatsRevealed).toBe(0);
  });

  test("activation boundaries: exact beat time activates the card", () => {
    expect(deriveActiveCard(FIXTURE, 0).cardIndex).toBe(0);
    expect(deriveActiveCard(FIXTURE, 699).cardIndex).toBe(0);
    expect(deriveActiveCard(FIXTURE, 700).cardIndex).toBe(1);
    expect(deriveActiveCard(FIXTURE, 2899).cardIndex).toBe(1);
    expect(deriveActiveCard(FIXTURE, 2900).cardIndex).toBe(2);
    expect(deriveActiveCard(FIXTURE, 5250).cardIndex).toBe(2);
  });

  test("localMs and progress are relative to the card's window", () => {
    const mid = deriveActiveCard(FIXTURE, 1800); // card 1: window 700 → 2900
    expect(mid.timing.localMs).toBe(1100);
    expect(mid.timing.progress).toBeCloseTo(1100 / 2200);
    const last = deriveActiveCard(FIXTURE, 5250); // card 2: window 2900 → end
    expect(last.timing.progress).toBe(1);
  });

  test("reducedMotion settles progress and beats", () => {
    const { timing } = deriveActiveCard(FIXTURE, 800, { reducedMotion: true });
    expect(timing.reducedMotion).toBe(true);
    expect(timing.progress).toBe(1);
    expect(timing.beatsRevealed).toBe(Number.POSITIVE_INFINITY);
  });

  test("clock past the end clamps instead of overrunning", () => {
    expect(deriveActiveCard(FIXTURE, 99999).cardIndex).toBe(2);
  });
});

describe("beatsRevealedAt", () => {
  test("zero before the base delay", () => {
    expect(beatsRevealedAt(0)).toBe(0);
    expect(beatsRevealedAt(BEAT_BASE_MS)).toBe(0);
  });

  test("advances one beat per stagger interval", () => {
    // Halfway through item 0's window (window == stagger).
    expect(beatsRevealedAt(BEAT_BASE_MS + BEAT_STAGGER_MS / 2)).toBeCloseTo(0.5);
    // Item 0 settles exactly as item 1's slot opens.
    const atItem1Start = BEAT_BASE_MS + BEAT_STAGGER_MS;
    expect(beatsRevealedAt(atItem1Start)).toBeCloseTo(1);
    expect(beatsRevealedAt(atItem1Start + BEAT_STAGGER_MS / 2)).toBeCloseTo(1.5);
  });

  test("monotonically non-decreasing", () => {
    let prev = -1;
    for (let ms = 0; ms <= 4000; ms += 50) {
      const v = beatsRevealedAt(ms);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("deriveActiveSentence", () => {
  test("finds the sentence containing the clock", () => {
    expect(deriveActiveSentence(FIXTURE, 100)).toEqual({ sentenceIndex: 0, wordIndex: 0 });
    expect(deriveActiveSentence(FIXTURE, 600)).toEqual({ sentenceIndex: 0, wordIndex: 2 });
    expect(deriveActiveSentence(FIXTURE, 3000)).toEqual({ sentenceIndex: 1, wordIndex: 2 });
  });

  test("null inside the inter-sentence gap", () => {
    expect(deriveActiveSentence(FIXTURE, 2100)).toEqual({ sentenceIndex: null, wordIndex: null });
  });

  test("word emphasis is the last word whose start has passed", () => {
    expect(deriveActiveSentence(FIXTURE, 450)?.wordIndex).toBe(1);
    expect(deriveActiveSentence(FIXTURE, 1999)?.wordIndex).toBe(3);
  });
});
