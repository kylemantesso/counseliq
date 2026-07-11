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

/**
 * Visual lead-in for card activation: cards enter slightly before the
 * anchored word so the reveal feels naturally in sync with narration.
 */
export const CARD_LEAD_IN_MS = 250;

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

type VisualBeat = { cardIndex: number; atMs: number };

function visualBeatSchedule(timing: UnitTiming): VisualBeat[] {
  const ordered = [...timing.cardBeats].sort(
    (a, b) => a.atMs - b.atMs || a.cardIndex - b.cardIndex
  );
  const visual: VisualBeat[] = [];
  let previousAt = -1;
  for (const beat of ordered) {
    let atMs = Math.max(0, beat.atMs - CARD_LEAD_IN_MS);
    if (atMs <= previousAt) atMs = previousAt + 1;
    visual.push({ cardIndex: beat.cardIndex, atMs });
    previousAt = atMs;
  }
  return visual;
}

/**
 * The active card at `unitClockMs`: the last visual beat whose atMs <= clock.
 * Visual beats are shifted earlier by CARD_LEAD_IN_MS so cards enter a touch
 * ahead of the spoken anchor. A card's window runs to the next visual beat
 * (or unit end), driving `progress`; `beatsRevealed` is synthesized from
 * localMs.
 */
export function deriveActiveCard(
  timing: UnitTiming,
  unitClockMs: number,
  opts: { reducedMotion?: boolean } = {}
): ActiveCard {
  const clock = clampClock(timing, unitClockMs);
  const reducedMotion = opts.reducedMotion ?? false;
  const beats = visualBeatSchedule(timing);
  let activeIndex: number | null = null;
  for (let i = 0; i < beats.length; i++) {
    if (beats[i].atMs <= clock) activeIndex = i;
    else break;
  }
  if (activeIndex === null) {
    return {
      cardIndex: null,
      timing: { localMs: 0, progress: 0, beatsRevealed: 0, reducedMotion },
    };
  }
  const active = beats[activeIndex];
  const nextAtMs = beats[activeIndex + 1]?.atMs ?? timing.totalDurationMs;
  const localMs = clock - active.atMs;
  const windowMs = Math.max(1, nextAtMs - active.atMs);
  // v2 media window for the active card (if any): playback position is the
  // clock offset into the window, clamped to the window's length so a
  // trimmed video pauses on its last in-window frame.
  const mediaWindow = timing.media.find(
    (window) => window.cardIndex === active.cardIndex
  );
  const media =
    mediaWindow !== undefined
      ? {
          positionMs: Math.max(
            0,
            Math.min(clock, mediaWindow.outMs) - mediaWindow.inMs
          ),
          durationMs: mediaWindow.outMs - mediaWindow.inMs,
        }
      : undefined;
  return {
    cardIndex: active.cardIndex,
    timing: {
      localMs,
      progress: reducedMotion ? 1 : Math.min(1, localMs / windowMs),
      beatsRevealed: reducedMotion ? Number.POSITIVE_INFINITY : beatsRevealedAt(localMs),
      reducedMotion,
      ...(media !== undefined ? { media } : {}),
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
