import type { CSSProperties } from "react";
import type { CardTiming } from "./timing";

/**
 * Pure interpolation utilities — every template animates by computing
 * `style = f(timing)` through these helpers. No CSS keyframes, no
 * transitions: styles are deterministic per timing value, which keeps
 * browser playback and Remotion frame capture pixel-identical.
 */

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;

/** Cubic ease-out — the mockups' default reveal feel (kFade/kFadeUp). */
export const easeOut: Easing = (t) => 1 - Math.pow(1 - t, 3);

/** Overshooting ease-out for kPop (scale .4 → ~1.05 → 1). */
export const easeOutBack: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export interface InterpolateOptions {
  easing?: Easing;
  /** Clamp the input to the range (default true). */
  clamp?: boolean;
}

export function interpolate(
  value: number,
  input: [number, number],
  output: [number, number],
  opts: InterpolateOptions = {}
): number {
  const { easing = linear, clamp = true } = opts;
  const [in0, in1] = input;
  const [out0, out1] = output;
  if (in0 === in1) return out1;
  let t = (value - in0) / (in1 - in0);
  if (clamp) t = Math.min(1, Math.max(0, t));
  return out0 + (out1 - out0) * easing(t);
}

/**
 * 0..1 progress of an entrance window starting `delayMs` into the card's
 * active life and lasting `durationMs`. Returns 1 under reduced motion so
 * every consumer settles instantly.
 */
export function msWindow(timing: CardTiming, delayMs: number, durationMs: number): number {
  if (timing.reducedMotion) return 1;
  if (durationMs <= 0) return timing.localMs >= delayMs ? 1 : 0;
  return Math.min(1, Math.max(0, (timing.localMs - delayMs) / durationMs));
}

/**
 * 0..1 entrance progress of internal beat `beatIndex` from
 * `timing.beatsRevealed` (fractional-count semantics; see CardTiming).
 */
export function beatProgress(timing: CardTiming, beatIndex: number): number {
  if (timing.reducedMotion) return 1;
  return Math.min(1, Math.max(0, timing.beatsRevealed - beatIndex));
}

// ---------------------------------------------------------------------------
// Style factories mirroring the mockup keyframes. Each takes an already
// eased-or-not 0..1 progress and returns deterministic inline styles; at
// t >= 1 the settled style carries no transform artifacts.
// ---------------------------------------------------------------------------

/** kFade — opacity only. */
export function fade(t: number): CSSProperties {
  if (t >= 1) return {};
  return { opacity: easeOut(t) };
}

/** kFadeUp — fade + rise from 14px. */
export function fadeUp(t: number): CSSProperties {
  if (t >= 1) return {};
  const e = easeOut(t);
  return { opacity: e, transform: `translateY(${(1 - e) * 14}px)` };
}

/** kSettle — scale 1.16 → 1 with fade. */
export function settle(t: number): CSSProperties {
  if (t >= 1) return {};
  const e = easeOut(t);
  return { opacity: e, transform: `scale(${1.16 - 0.16 * e})` };
}

/** kPop — scale .4 → 1 with overshoot. */
export function pop(t: number): CSSProperties {
  if (t >= 1) return {};
  const e = easeOutBack(t);
  return { opacity: Math.min(1, easeOut(t) * 1.5), transform: `scale(${0.4 + 0.6 * e})` };
}

/** kGrowX — scaleX 0 → 1, origin left (rules, meter fills). */
export function growX(t: number): CSSProperties {
  if (t >= 1) return { transformOrigin: "left center" };
  return { transform: `scaleX(${easeOut(t)})`, transformOrigin: "left center" };
}

/** kGrowY — scaleY 0 → 1, origin top (timeline spines). */
export function growY(t: number): CSSProperties {
  if (t >= 1) return { transformOrigin: "center top" };
  return { transform: `scaleY(${easeOut(t)})`, transformOrigin: "center top" };
}

export type PanDirection = "left" | "right" | "up" | "down";

/**
 * kPan — slow Ken Burns drift across the card's WHOLE active window
 * (drive with `timing.progress`, not an entrance window). Linear on
 * purpose: a photo drift should not decelerate.
 */
export function pan(t: number, direction: PanDirection): CSSProperties {
  const p = Math.min(1, Math.max(0, t));
  const drift = 4; // percent of the oversized image traversed
  const dx = direction === "left" ? -drift * p : direction === "right" ? drift * p : 0;
  const dy = direction === "up" ? -drift * p : direction === "down" ? drift * p : 0;
  return { transform: `scale(1.12) translate(${dx}%, ${dy}%)` };
}
