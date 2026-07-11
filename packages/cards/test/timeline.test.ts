import { unitTimingSchema, type UnitTiming } from "@counseliq/course-schema";
import { describe, expect, test } from "vitest";
import {
  BEAT_BASE_MS,
  BEAT_STAGGER_MS,
  CARD_LEAD_IN_MS,
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
  media: [
    // Card 1's asset: 1500ms video inside its 700-2900ms window.
    { cardIndex: 1, inMs: 700, outMs: 2200 },
  ],
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

  test("activation boundaries: cards activate with a 250ms visual lead-in", () => {
    expect(deriveActiveCard(FIXTURE, 0).cardIndex).toBe(0);
    expect(deriveActiveCard(FIXTURE, 449).cardIndex).toBe(0);
    expect(deriveActiveCard(FIXTURE, 450).cardIndex).toBe(1);
    expect(deriveActiveCard(FIXTURE, 2649).cardIndex).toBe(1);
    expect(deriveActiveCard(FIXTURE, 2650).cardIndex).toBe(2);
    expect(deriveActiveCard(FIXTURE, 5250).cardIndex).toBe(2);
  });

  test("localMs and progress are relative to the card's window", () => {
    const mid = deriveActiveCard(FIXTURE, 1800); // card 1: window 450 → 2650
    expect(mid.timing.localMs).toBe(1350);
    expect(mid.timing.progress).toBeCloseTo(1350 / 2200);
    const last = deriveActiveCard(FIXTURE, 5250); // card 2: window 2650 → end
    expect(last.timing.progress).toBe(1);
  });

  test("lead-in never starts cards before unit time 0", () => {
    const shifted: UnitTiming = {
      ...FIXTURE,
      cardBeats: [
        { cardIndex: 0, atMs: 100 },
        { cardIndex: 1, atMs: 200 },
      ],
    };
    expect(CARD_LEAD_IN_MS).toBe(250);
    expect(deriveActiveCard(shifted, 0).cardIndex).toBe(0);
    expect(deriveActiveCard(shifted, 1).cardIndex).toBe(1);
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

describe("deriveActiveCard media windows (timing v2)", () => {
  test("no media field for cards without a window", () => {
    expect(deriveActiveCard(FIXTURE, 100).timing.media).toBeUndefined();
    expect(deriveActiveCard(FIXTURE, 3000).timing.media).toBeUndefined();
  });

  test("position advances with the clock inside the window", () => {
    const at = (clock: number) => deriveActiveCard(FIXTURE, clock).timing.media;
    expect(at(700)).toEqual({ positionMs: 0, durationMs: 1500 });
    expect(at(1400)).toEqual({ positionMs: 700, durationMs: 1500 });
  });

  test("position clamps at the out point (hold last frame)", () => {
    // Clock past outMs but still inside the card's window (until 2900).
    expect(deriveActiveCard(FIXTURE, 2500).timing.media).toEqual({
      positionMs: 1500,
      durationMs: 1500,
    });
  });
});
