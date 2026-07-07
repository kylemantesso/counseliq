import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnitTiming } from "@counseliq/course-schema";
import type { UnitClockStore } from "./clock-store.web";
import { nextAfterSentence, seekTarget } from "./timeline-helpers";

/**
 * The audio engine: per-sentence mp3s sequenced through two
 * HTMLAudioElements (A/B swap — the next sentence preloads on the idle
 * element), publishing the unit clock to the clock store on a rAF loop.
 *
 * The AUDIO ELEMENT IS THE ONLY CLOCK: while a sentence plays,
 * unitClockMs = sentence.startMs + audioEl.currentTime * 1000. Artifact
 * gaps between sentences (interSentenceGapMs) are waited out by
 * free-running the clock to the next sentence's startMs — the one place
 * wall-clock time is consulted, and only to span silence the artifact
 * itself defines.
 *
 * Presigned URLs never appear anywhere except the elements' src.
 */

export interface UseUnitAudioInput {
  timing: UnitTiming | null | undefined;
  /** audioKey → presigned URL. */
  urls: ReadonlyMap<string, string>;
  muted: boolean;
  clock: UnitClockStore;
  /** Fired when the final sentence finishes. */
  onEnded?: () => void;
  /** Fired on a media error for an audioKey (host re-presigns). */
  onError?: (audioKey: string) => void;
}

export interface UnitAudioControls {
  playing: boolean;
  /** Every sentence in the unit has a resolvable URL. */
  ready: boolean;
  currentSentenceIndex: number;
  play(): void;
  pause(): void;
  skipToSentence(index: number): void;
  replayUnit(): void;
  seekToClockMs(ms: number): void;
}

interface GapState {
  untilMs: number;
  nextIndex: number;
  anchorClockMs: number;
  anchorPerfMs: number;
}

export function useUnitAudio({
  timing,
  urls,
  muted,
  clock,
  onEnded,
  onError,
}: UseUnitAudioInput): UnitAudioControls {
  const elARef = useRef<HTMLAudioElement | null>(null);
  const elBRef = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef<"a" | "b">("a");
  const sentenceRef = useRef(0);
  const playingRef = useRef(false);
  const gapRef = useRef<GapState | null>(null);
  const rafRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);

  const timingRef = useRef(timing);
  timingRef.current = timing;
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const activeEl = () => (activeRef.current === "a" ? elARef.current : elBRef.current);
  const idleEl = () => (activeRef.current === "a" ? elBRef.current : elARef.current);

  const ensureElements = useCallback(() => {
    if (!elARef.current) {
      elARef.current = document.createElement("audio");
      elBRef.current = document.createElement("audio");
      for (const el of [elARef.current, elBRef.current]) {
        el.preload = "auto";
      }
    }
    return { a: elARef.current!, b: elBRef.current! };
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const setPlayingBoth = useCallback((value: boolean) => {
    playingRef.current = value;
    setPlaying(value);
  }, []);

  const urlFor = useCallback((index: number): string | null => {
    const t = timingRef.current;
    if (!t || index < 0 || index >= t.sentences.length) return null;
    return urlsRef.current.get(t.sentences[index].audioKey) ?? null;
  }, []);

  const loadInto = useCallback(
    (el: HTMLAudioElement | null, index: number) => {
      if (!el) return false;
      const url = urlFor(index);
      if (!url) return false;
      if (el.src !== url) el.src = url;
      el.muted = muted;
      return true;
    },
    [muted, urlFor]
  );

  /** rAF publisher: audio-derived clock while a sentence plays, free-run in gaps. */
  const tick = useCallback(() => {
    if (!playingRef.current) return;
    const t = timingRef.current;
    if (!t) return;
    const gap = gapRef.current;
    if (gap) {
      const now = gap.anchorClockMs + (performance.now() - gap.anchorPerfMs);
      if (now >= gap.untilMs) {
        gapRef.current = null;
        startSentenceRef.current(gap.nextIndex);
        return;
      }
      clock.set(Math.round(now));
    } else {
      const el = activeEl();
      if (el) {
        const s = t.sentences[sentenceRef.current];
        if (s) clock.set(Math.round(s.startMs + el.currentTime * 1000));
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [clock]);

  // startSentence is recursive-through-events; hold it in a ref so the
  // stable 'ended' listener and gap ticks call the latest closure.
  const startSentenceRef = useRef<(index: number) => void>(() => {});
  const startSentence = useCallback(
    (index: number) => {
      const t = timingRef.current;
      if (!t) return;
      ensureElements();
      const el = activeEl();
      if (!loadInto(el, index)) {
        const key = t.sentences[index]?.audioKey;
        setPlayingBoth(false);
        stopRaf();
        if (key) onErrorRef.current?.(key);
        return;
      }
      sentenceRef.current = index;
      setCurrentSentenceIndex(index);
      el!.currentTime = 0;
      void el!.play().catch(() => {
        setPlayingBoth(false);
        stopRaf();
      });
      // Preload the next sentence on the idle element.
      loadInto(idleEl(), index + 1);
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
    },
    [ensureElements, loadInto, setPlayingBoth, stopRaf, tick]
  );
  startSentenceRef.current = startSentence;

  /** 'ended' on the active element → next sentence, gap wait, or unit end. */
  const handleEnded = useCallback(() => {
    const t = timingRef.current;
    if (!t || !playingRef.current) return;
    const idx = sentenceRef.current;
    const action = nextAfterSentence(t, idx);
    if (action.kind === "ended") {
      clock.set(t.totalDurationMs);
      setPlayingBoth(false);
      stopRaf();
      onEndedRef.current?.();
      return;
    }
    // Swap: the idle element (already preloaded) becomes active.
    activeRef.current = activeRef.current === "a" ? "b" : "a";
    if (action.kind === "wait-gap") {
      const s = t.sentences[idx];
      gapRef.current = {
        untilMs: action.untilMs,
        nextIndex: action.sentenceIndex,
        anchorClockMs: s.startMs + s.durationMs,
        anchorPerfMs: performance.now(),
      };
      return; // rAF loop is already running and will start the next sentence.
    }
    startSentenceRef.current(action.sentenceIndex);
  }, [clock, setPlayingBoth, stopRaf]);

  // Attach media listeners once per element pair.
  useEffect(() => {
    const { a, b } = ensureElements();
    const errorFor = (el: HTMLAudioElement) => () => {
      const t = timingRef.current;
      if (!t) return;
      const s = t.sentences[sentenceRef.current];
      setPlayingBoth(false);
      stopRaf();
      if (s) onErrorRef.current?.(s.audioKey);
    };
    const endedA = () => {
      if (activeRef.current === "a") handleEnded();
    };
    const endedB = () => {
      if (activeRef.current === "b") handleEnded();
    };
    const errA = errorFor(a);
    const errB = errorFor(b);
    a.addEventListener("ended", endedA);
    b.addEventListener("ended", endedB);
    a.addEventListener("error", errA);
    b.addEventListener("error", errB);
    return () => {
      a.removeEventListener("ended", endedA);
      b.removeEventListener("ended", endedB);
      a.removeEventListener("error", errA);
      b.removeEventListener("error", errB);
    };
  }, [ensureElements, handleEnded, setPlayingBoth, stopRaf]);

  // Reset on unit (timing identity) change.
  useEffect(() => {
    elARef.current?.pause();
    elBRef.current?.pause();
    gapRef.current = null;
    sentenceRef.current = 0;
    setCurrentSentenceIndex(0);
    setPlayingBoth(false);
    stopRaf();
    clock.set(0);
  }, [timing, clock, setPlayingBoth, stopRaf]);

  // Mute both elements without touching the clock.
  useEffect(() => {
    if (elARef.current) elARef.current.muted = muted;
    if (elBRef.current) elBRef.current.muted = muted;
  }, [muted]);

  // Teardown.
  useEffect(() => {
    return () => {
      stopRaf();
      for (const el of [elARef.current, elBRef.current]) {
        if (el) {
          el.pause();
          el.removeAttribute("src");
        }
      }
    };
  }, [stopRaf]);

  const play = useCallback(() => {
    const t = timingRef.current;
    if (!t || playingRef.current) return;
    setPlayingBoth(true);
    const gap = gapRef.current;
    if (gap) {
      // Re-anchor the free-running gap clock at the paused position.
      gap.anchorClockMs = clock.getSnapshot();
      gap.anchorPerfMs = performance.now();
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    const el = activeEl();
    if (el && el.src && el.paused && el.currentTime > 0) {
      // Resume mid-sentence.
      void el.play().catch(() => setPlayingBoth(false));
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    startSentenceRef.current(sentenceRef.current);
  }, [clock, setPlayingBoth, stopRaf, tick]);

  const pause = useCallback(() => {
    setPlayingBoth(false);
    activeEl()?.pause();
    stopRaf();
  }, [setPlayingBoth, stopRaf]);

  const seekToClockMs = useCallback(
    (ms: number) => {
      const t = timingRef.current;
      if (!t) return;
      const target = seekTarget(t.sentences, ms);
      if (!target) {
        pause();
        clock.set(t.totalDurationMs);
        return;
      }
      const wasPlaying = playingRef.current;
      gapRef.current = null;
      ensureElements();
      const el = activeEl();
      if (!loadInto(el, target.sentenceIndex)) {
        const key = t.sentences[target.sentenceIndex]?.audioKey;
        pause();
        if (key) onErrorRef.current?.(key);
        return;
      }
      sentenceRef.current = target.sentenceIndex;
      setCurrentSentenceIndex(target.sentenceIndex);
      el!.currentTime = target.offsetMs / 1000;
      clock.set(t.sentences[target.sentenceIndex].startMs + target.offsetMs);
      loadInto(idleEl(), target.sentenceIndex + 1);
      if (wasPlaying) {
        void el!.play().catch(() => setPlayingBoth(false));
        stopRaf();
        rafRef.current = requestAnimationFrame(tick);
      } else {
        el!.pause();
      }
    },
    [clock, ensureElements, loadInto, pause, setPlayingBoth, stopRaf, tick]
  );

  const skipToSentence = useCallback(
    (index: number) => {
      const t = timingRef.current;
      if (!t) return;
      const clampedIndex = Math.min(t.sentences.length - 1, Math.max(0, index));
      seekToClockMs(t.sentences[clampedIndex].startMs);
    },
    [seekToClockMs]
  );

  const replayUnit = useCallback(() => {
    skipToSentence(0);
  }, [skipToSentence]);

  const ready = useMemo(() => {
    if (!timing) return false;
    return timing.sentences.every((s) => urls.has(s.audioKey));
  }, [timing, urls]);

  return {
    playing,
    ready,
    currentSentenceIndex,
    play,
    pause,
    skipToSentence,
    replayUnit,
    seekToClockMs,
  };
}
