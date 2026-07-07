import { describe, expect, test } from "vitest";
import {
  courseProgressPct,
  flattenUnits,
  formatMs,
  nextAfterSentence,
  nextPhase,
  phaseFraction,
  phasesForUnit,
  seekTarget,
  sentenceForClock,
  type SentenceWindow,
} from "../timeline-helpers";
import type { PreviewModule, PreviewUnit } from "../types";

/**
 * The audio engine is a thin shell over these pure decisions — boundaries,
 * gaps, seeks, and progress are what actually sequence playback.
 */

// Three sentences with a 250ms artifact gap between each:
// [0, 2000) · gap · [2250, 4250) · gap · [4500, 6000)
const SENTENCES: SentenceWindow[] = [
  { startMs: 0, durationMs: 2000 },
  { startMs: 2250, durationMs: 2000 },
  { startMs: 4500, durationMs: 1500 },
];
const TIMING = { sentences: SENTENCES, totalDurationMs: 6000 };

describe("sentenceForClock", () => {
  test("start boundary is inside, end boundary is outside", () => {
    expect(sentenceForClock(SENTENCES, 0)).toBe(0);
    expect(sentenceForClock(SENTENCES, 1999)).toBe(0);
    expect(sentenceForClock(SENTENCES, 2000)).toBeNull(); // gap
    expect(sentenceForClock(SENTENCES, 2250)).toBe(1);
  });

  test("null in gaps and past the end", () => {
    expect(sentenceForClock(SENTENCES, 2100)).toBeNull();
    expect(sentenceForClock(SENTENCES, 4400)).toBeNull();
    expect(sentenceForClock(SENTENCES, 6001)).toBeNull();
  });
});

describe("seekTarget", () => {
  test("maps an in-sentence clock to sentence + offset", () => {
    expect(seekTarget(SENTENCES, 2750)).toEqual({ sentenceIndex: 1, offsetMs: 500 });
  });

  test("a gap seek lands at the NEXT sentence start", () => {
    expect(seekTarget(SENTENCES, 2100)).toEqual({ sentenceIndex: 1, offsetMs: 0 });
  });

  test("negative clamps to the first sentence", () => {
    expect(seekTarget(SENTENCES, -50)).toEqual({ sentenceIndex: 0, offsetMs: 0 });
  });

  test("past the final sentence end returns null", () => {
    expect(seekTarget(SENTENCES, 6000)).toBeNull();
  });
});

describe("nextAfterSentence", () => {
  test("gap between sentences → wait-gap until next start", () => {
    expect(nextAfterSentence(TIMING, 0)).toEqual({
      kind: "wait-gap",
      untilMs: 2250,
      sentenceIndex: 1,
    });
  });

  test("no gap → play immediately", () => {
    const contiguous = {
      sentences: [
        { startMs: 0, durationMs: 1000 },
        { startMs: 1000, durationMs: 1000 },
      ],
      totalDurationMs: 2000,
    };
    expect(nextAfterSentence(contiguous, 0)).toEqual({ kind: "play", sentenceIndex: 1 });
  });

  test("last sentence → ended", () => {
    expect(nextAfterSentence(TIMING, 2)).toEqual({ kind: "ended" });
  });
});

describe("progress", () => {
  test("phase fractions match the mockup curve", () => {
    expect(phaseFraction("hook")).toBe(0.12);
    expect(phaseFraction("content", 0)).toBeCloseTo(0.15);
    expect(phaseFraction("content", 1)).toBeCloseTo(0.8);
    expect(phaseFraction("anchor")).toBe(0.92);
  });

  test("courseProgressPct spans units", () => {
    expect(courseProgressPct(0, 10, 0)).toBe(0);
    expect(courseProgressPct(9, 10, 1)).toBe(100);
    expect(courseProgressPct(4, 10, 0.5)).toBeCloseTo(45);
    expect(courseProgressPct(0, 0, 1)).toBe(0);
  });
});

describe("formatMs", () => {
  test("rounds to m:ss", () => {
    expect(formatMs(0)).toBe("0:00");
    expect(formatMs(93_500)).toBe("1:34"); // 93.5s rounds to 94
    expect(formatMs(600_000)).toBe("10:00");
  });
});

function makeUnit(overrides: Partial<PreviewUnit>): PreviewUnit {
  return {
    id: "u1",
    unitKey: "mu-101",
    concept: "test-concept",
    state: "assets_ready",
    narration: [],
    cards: [],
    meta: {
      hook: { questionRef: "q1" },
      retrieve: ["q2"],
      anchor: { template: "takeaway-card", props: {} },
    },
    ...overrides,
  };
}

describe("unit phases", () => {
  test("full unit walks hook → content → retrieve → anchor", () => {
    const unit = makeUnit({});
    expect(phasesForUnit(unit)).toEqual(["hook", "content", "retrieve", "anchor"]);
    expect(nextPhase(unit, "content")).toBe("retrieve");
    expect(nextPhase(unit, "anchor")).toBeNull();
  });

  test("missing hook and empty retrieve are skipped", () => {
    const unit = makeUnit({ meta: { hook: null, retrieve: [], anchor: { template: "takeaway-card", props: {} } } });
    expect(phasesForUnit(unit)).toEqual(["content", "anchor"]);
    expect(nextPhase(unit, "content")).toBe("anchor");
  });
});

describe("flattenUnits", () => {
  test("preserves order and module context", () => {
    const modules: PreviewModule[] = [
      { moduleKey: "m1", moduleTitle: "One", units: [makeUnit({ unitKey: "mu-101" }), makeUnit({ unitKey: "mu-102" })] },
      { moduleKey: "m2", moduleTitle: "Two", units: [makeUnit({ unitKey: "mu-201" })] },
    ];
    const flat = flattenUnits(modules);
    expect(flat.map((f) => f.unit.unitKey)).toEqual(["mu-101", "mu-102", "mu-201"]);
    expect(flat[2]).toMatchObject({ moduleIndex: 1, unitIndexInModule: 0, flatIndex: 2 });
  });
});
