/**
 * The card timing contract — cards are pure functions of
 * `(props, timing, theme)` with NO clocks inside (no timers, no frame
 * callbacks, no wall-clock reads). The host (gate-3 player now, Remotion in
 * M6) owns the clock and
 * drives every card by passing a `CardTiming` computed from the unit's
 * timing artifact. This is what makes browser playback and frame-by-frame
 * video rendering produce identical output.
 */

export interface CardTiming {
  /**
   * Milliseconds since this card became active
   * (unitClockMs - cardEnterMs), clamped >= 0. Drives entrance choreography
   * at design speeds (the mockups' 0.1s–1.4s delays map onto this axis).
   */
  localMs: number;
  /**
   * 0..1 across the card's full active window (enter → next card enter or
   * unit end). Drives whole-window motion: Ken Burns pan, timeline spine
   * grow.
   */
  progress: number;
  /**
   * Fractional count of internal beats revealed. floor(x) items are fully
   * settled; item floor(x) is at frac(x) of its entrance animation. Cards
   * with no internal beats ignore it. Infinity = all revealed.
   */
  beatsRevealed: number;
  /** Render the settled end state with no motion (prefers-reduced-motion). */
  reducedMotion: boolean;
}

/** Fully settled timing — static previews, anchors, reduced motion. */
export const SETTLED_TIMING: CardTiming = {
  localMs: Number.MAX_SAFE_INTEGER,
  progress: 1,
  beatsRevealed: Number.POSITIVE_INFINITY,
  reducedMotion: true,
};

/** The props every template component receives. */
export interface CardComponentProps<P> {
  props: P;
  timing: CardTiming;
}
