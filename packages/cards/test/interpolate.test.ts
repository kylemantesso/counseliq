import { describe, expect, test } from "vitest";
import {
  beatProgress,
  easeOut,
  easeOutBack,
  fade,
  fadeUp,
  growX,
  growY,
  interpolate,
  linear,
  msWindow,
  pan,
  pop,
  settle,
} from "../src/interpolate";
import { SETTLED_TIMING, type CardTiming } from "../src/timing";

const timing = (localMs: number, beatsRevealed = 0): CardTiming => ({
  localMs,
  progress: 0,
  beatsRevealed,
  reducedMotion: false,
});

describe("interpolate", () => {
  test("maps linearly across the range", () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(0, [0, 10], [20, 40])).toBe(20);
    expect(interpolate(10, [0, 10], [20, 40])).toBe(40);
  });

  test("clamps by default, extrapolates when disabled", () => {
    expect(interpolate(20, [0, 10], [0, 100])).toBe(100);
    expect(interpolate(-5, [0, 10], [0, 100])).toBe(0);
    expect(interpolate(20, [0, 10], [0, 100], { clamp: false })).toBe(200);
  });

  test("degenerate input range returns the end value", () => {
    expect(interpolate(3, [5, 5], [0, 100])).toBe(100);
  });

  test("easings hit both endpoints", () => {
    for (const easing of [linear, easeOut, easeOutBack]) {
      expect(easing(0)).toBeCloseTo(0, 5);
      expect(easing(1)).toBeCloseTo(1, 5);
    }
    // Overshoot in the middle-late region is the point of easeOutBack.
    expect(easeOutBack(0.8)).toBeGreaterThan(1);
  });
});

describe("msWindow", () => {
  test("progresses through the window", () => {
    expect(msWindow(timing(0), 100, 500)).toBe(0);
    expect(msWindow(timing(100), 100, 500)).toBe(0);
    expect(msWindow(timing(350), 100, 500)).toBeCloseTo(0.5);
    expect(msWindow(timing(600), 100, 500)).toBe(1);
    expect(msWindow(timing(9999), 100, 500)).toBe(1);
  });

  test("zero-duration window is a step", () => {
    expect(msWindow(timing(99), 100, 0)).toBe(0);
    expect(msWindow(timing(100), 100, 0)).toBe(1);
  });

  test("reduced motion settles instantly", () => {
    expect(msWindow(SETTLED_TIMING, 5000, 500)).toBe(1);
    expect(msWindow({ ...timing(0), reducedMotion: true }, 5000, 500)).toBe(1);
  });
});

describe("beatProgress", () => {
  test("fractional beats: settled below floor, partial at floor, zero above", () => {
    const t = timing(0, 1.5);
    expect(beatProgress(t, 0)).toBe(1);
    expect(beatProgress(t, 1)).toBe(0.5);
    expect(beatProgress(t, 2)).toBe(0);
  });

  test("Infinity reveals everything", () => {
    expect(beatProgress(timing(0, Number.POSITIVE_INFINITY), 41)).toBe(1);
  });

  test("reduced motion reveals everything", () => {
    expect(beatProgress({ ...timing(0, 0), reducedMotion: true }, 7)).toBe(1);
  });
});

describe("style factories settle cleanly at t >= 1", () => {
  test("no opacity/transform residue when settled", () => {
    expect(fade(1)).toEqual({});
    expect(fadeUp(1)).toEqual({});
    expect(settle(1)).toEqual({});
    expect(pop(1)).toEqual({});
    expect(growX(1)).toEqual({ transformOrigin: "left center" });
    expect(growY(1)).toEqual({ transformOrigin: "center top" });
  });

  test("mid-progress styles are populated and deterministic", () => {
    expect(fadeUp(0.5)).toEqual(fadeUp(0.5));
    expect(fadeUp(0.5).opacity).toBeGreaterThan(0);
    expect(String(fadeUp(0.5).transform)).toMatch(/translateY/);
    expect(String(pop(0.5).transform)).toMatch(/scale/);
  });

  test("pan drifts with progress in the given direction", () => {
    expect(String(pan(0, "left").transform)).toContain("translate(0%, 0%)");
    expect(String(pan(1, "left").transform)).toContain("translate(-4%, 0%)");
    expect(String(pan(0.5, "down").transform)).toContain("translate(0%, 2%)");
  });
});

// --- fitDisplayFontSize (width-aware display sizing) ---
import { fitDisplayFontSize } from "../src/fit";

describe("fitDisplayFontSize", () => {
  test("short text keeps the mockup size", () => {
    expect(fitDisplayFontSize("42nd", 108)).toBe(108);
    expect(fitDisplayFontSize("Key dates", 47)).toBe(47);
  });

  test("a long single word shrinks to fit the 300px column", () => {
    const size = fitDisplayFontSize("Acknowledgement of Country", 47);
    // "Acknowledgement" = 15 chars -> floor(300 / (0.58 * 15)) = 34
    expect(size).toBe(34);
    expect(size * 0.58 * 15).toBeLessThanOrEqual(300);
  });

  test("pathological words clamp at the floor", () => {
    expect(fitDisplayFontSize("a".repeat(60), 47)).toBe(22);
    expect(fitDisplayFontSize("a".repeat(60), 92, { minPx: 30 })).toBe(30);
  });

  test("empty text keeps the max", () => {
    expect(fitDisplayFontSize("", 47)).toBe(47);
    expect(fitDisplayFontSize(undefined, 47)).toBe(47);
  });
});
