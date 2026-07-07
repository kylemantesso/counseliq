import type { UnitTiming } from "@counseliq/course-schema";
import type { CardTiming } from "./timing";

/**
 * Pure derivations over the UnitTiming artifact — the bridge from the
 * host's unit clock to per-card CardTiming and caption state. Shared by the
 * gate-3 player and (in M6) the Remotion renderer: both call these with a
 * clock they own.
 *
 * `reducedMotion` is deliberately NOT decided here — callers set it on the
 * returned CardTiming from their environment (prefers-reduced-motion).
 */

/**
 * Design stagger for internal card beats: item i begins entering at
 * BEAT_BASE_MS + i * BEAT_STAGGER_MS. The artifact times card ENTRIES only;
 * the fractional beatsRevealed count is synthesized from localMs (matching
 * the mockups' per-item delays).
 *
 * The scalar contract (`beatProgress = clamp(beatsRevealed - i)`) means each
 * item's entrance window necessarily equals the stagger — the count advances
 * linearly at one beat per BEAT_STAGGER_MS.
 */
export const BEAT_BASE_MS = 450;
export const BEAT_STAGGER_MS = 200;

/** Continuous fractional beats-revealed count at `localMs` into a card. */
export function beatsRevealedAt(localMs: number): number {
  return Math.max(0, (localMs - BEAT_BASE_MS) / BEAT_STAGGER_MS);
}

/** Clamp a host clock into the unit's valid range [0, totalDurationMs]. */
export function clampClock(timing: UnitTiming, ms: number): number {
  return Math.min(timing.totalDurationMs, Math.max(0, ms));
}

export interface ActiveCard {
  /** Index into microUnits.cards, or null before the first beat. */
  cardIndex: number | null;
  timing: CardTiming;
}

/**
 * The active card at `unitClockMs`: the last cardBeat whose atMs <= clock.
 * Its window runs to the next beat's atMs (or unit end), driving
 * `progress`; `beatsRevealed` is synthesized from localMs.
 */
export function deriveActiveCard(
  timing: UnitTiming,
  unitClockMs: number,
  opts: { reducedMotion?: boolean } = {}
): ActiveCard {
  const clock = clampClock(timing, unitClockMs);
  const reducedMotion = opts.reducedMotion ?? false;
  // cardBeats are produced in card order but resolved times may interleave;
  // pick by time, deterministically preferring the later beat on ties.
  let active: { cardIndex: number; atMs: number } | null = null;
  let nextAtMs = timing.totalDurationMs;
  for (const beat of timing.cardBeats) {
    if (beat.atMs <= clock && (active === null || beat.atMs >= active.atMs)) {
      active = beat;
    }
  }
  if (active === null) {
    return {
      cardIndex: null,
      timing: { localMs: 0, progress: 0, beatsRevealed: 0, reducedMotion },
    };
  }
  for (const beat of timing.cardBeats) {
    if (beat.atMs > active.atMs && beat.atMs < nextAtMs) nextAtMs = beat.atMs;
  }
  const localMs = clock - active.atMs;
  const windowMs = Math.max(1, nextAtMs - active.atMs);
  return {
    cardIndex: active.cardIndex,
    timing: {
      localMs,
      progress: reducedMotion ? 1 : Math.min(1, localMs / windowMs),
      beatsRevealed: reducedMotion ? Number.POSITIVE_INFINITY : beatsRevealedAt(localMs),
      reducedMotion,
    },
  };
}

export interface ActiveSentence {
  /** Index into timing.sentences, or null inside an inter-sentence gap. */
  sentenceIndex: number | null;
  /** Index into that sentence's words, or null when sentenceIndex is null. */
  wordIndex: number | null;
}

/**
 * The sentence whose [startMs, startMs + durationMs) window contains the
 * clock (null in gaps), and the last word within it whose startMs has
 * passed — captions emphasize that word.
 */
export function deriveActiveSentence(timing: UnitTiming, unitClockMs: number): ActiveSentence {
  const clock = clampClock(timing, unitClockMs);
  for (let i = 0; i < timing.sentences.length; i++) {
    const s = timing.sentences[i];
    if (clock < s.startMs || clock >= s.startMs + s.durationMs) continue;
    let wordIndex: number | null = null;
    for (let w = 0; w < s.words.length; w++) {
      if (s.words[w].startMs <= clock) wordIndex = w;
    }
    return { sentenceIndex: i, wordIndex };
  }
  return { sentenceIndex: null, wordIndex: null };
}
