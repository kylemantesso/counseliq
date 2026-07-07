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
 * SILENT FALLBACK: a sentence whose audio cannot load (missing object,
 * expired URL, undecodable bytes — mock-mode artifacts are all three)
 * free-runs the clock through its artifact duration instead of halting
 * playback, so cards/captions stay reviewable and audio rejoins on the
 * next healthy sentence. The host is still notified per failed key so it
 * can re-presign.
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
  /** audioKeys that 404'd/failed to decode — their sentences run silent. */
  const failedKeysRef = useRef<Set<string>>(new Set());
  const notifiedKeysRef = useRef<Set<string>>(new Set());

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
      const t = timingRef.current;
      const key = t?.sentences[index]?.audioKey;
      if (!key || failedKeysRef.current.has(key)) return false;
      const url = urlFor(index);
      if (!url) return false;
      if (el.src !== url) el.src = url;
      // Error attribution: the pair-level 'error' listener needs to know
      // which sentence an element was carrying (idle preloads error too).
      el.dataset.ciqSentenceIndex = String(index);
      el.muted = muted;
      return true;
    },
    [muted, urlFor]
  );

  const notifyKeyFailed = useCallback((key: string) => {
    failedKeysRef.current.add(key);
    if (notifiedKeysRef.current.has(key)) return;
    notifiedKeysRef.current.add(key);
    onErrorRef.current?.(key);
  }, []);

  const finishUnit = useCallback(() => {
    const t = timingRef.current;
    if (!t) return;
    clock.set(t.totalDurationMs);
    setPlayingBoth(false);
    stopRaf();
    onEndedRef.current?.();
  }, [clock, setPlayingBoth, stopRaf]);

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
        if (gap.nextIndex >= t.sentences.length) {
          finishUnit();
          return;
        }
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
  }, [clock, finishUnit]);

  // startSentence/startSilent are recursive-through-events; hold them in
  // refs so the stable 'ended'/'error' listeners and gap ticks call the
  // latest closures.
  const startSentenceRef = useRef<(index: number) => void>(() => {});
  const startSilentRef = useRef<(index: number, fromMs?: number) => void>(() => {});

  /**
   * Free-run the clock through a sentence whose audio is unavailable:
   * same mechanism as artifact gaps, spanning the sentence (and the gap
   * that follows it) up to the next sentence's start.
   */
  const startSilent = useCallback(
    (index: number, fromMs?: number) => {
      const t = timingRef.current;
      if (!t) return;
      const s = t.sentences[index];
      if (!s) return;
      const next = t.sentences[index + 1];
      sentenceRef.current = index;
      setCurrentSentenceIndex(index);
      const anchor = Math.max(fromMs ?? s.startMs, s.startMs);
      gapRef.current = {
        untilMs: next ? next.startMs : t.totalDurationMs,
        nextIndex: index + 1,
        anchorClockMs: anchor,
        anchorPerfMs: performance.now(),
      };
      clock.set(Math.round(anchor));
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
    },
    [clock, stopRaf, tick]
  );
  startSilentRef.current = startSilent;

  const startSentence = useCallback(
    (index: number) => {
      const t = timingRef.current;
      if (!t) return;
      ensureElements();
      const el = activeEl();
      if (!loadInto(el, index)) {
        // Missing URL or known-failed audio: notify the host (it may
        // re-presign for later) and keep reviewing silently.
        const key = t.sentences[index]?.audioKey;
        if (key) notifyKeyFailed(key);
        startSilentRef.current(index);
        return;
      }
      sentenceRef.current = index;
      setCurrentSentenceIndex(index);
      el!.currentTime = 0;
      void el!.play().catch(() => {
        // Playback refused (load failure races land in the 'error'
        // listener; autoplay policy shouldn't apply — play() is
        // user-gesture-initiated). Fall back to the silent clock.
        if (sentenceRef.current === index && playingRef.current && !gapRef.current) {
          startSilentRef.current(index);
        }
      });
      // Preload the next sentence on the idle element.
      loadInto(idleEl(), index + 1);
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
    },
    [ensureElements, loadInto, notifyKeyFailed, stopRaf, tick]
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
      // Attribute the error to the sentence the ELEMENT carries — idle
      // preloads error too, and must not interrupt the active sentence.
      const elIndex = Number(el.dataset.ciqSentenceIndex ?? "-1");
      const key = t.sentences[elIndex]?.audioKey;
      if (key) notifyKeyFailed(key);
      const isActiveSentence =
        elIndex === sentenceRef.current && !gapRef.current;
      if (isActiveSentence && playingRef.current) {
        // The playing sentence died: continue silently from where the
        // clock got to.
        startSilentRef.current(elIndex, clock.getSnapshot());
      }
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
  }, [clock, ensureElements, handleEnded, notifyKeyFailed]);

  // Reset on unit (timing identity) change. Failed keys are cleared —
  // re-synthesised audio (new keys or fresh URLs) gets a fresh chance.
  useEffect(() => {
    elARef.current?.pause();
    elBRef.current?.pause();
    gapRef.current = null;
    sentenceRef.current = 0;
    setCurrentSentenceIndex(0);
    setPlayingBoth(false);
    stopRaf();
    failedKeysRef.current.clear();
    notifiedKeysRef.current.clear();
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
        // Unplayable audio at the seek target: position the clock there;
        // free-run silently if we were playing.
        const key = t.sentences[target.sentenceIndex]?.audioKey;
        if (key) notifyKeyFailed(key);
        sentenceRef.current = target.sentenceIndex;
        setCurrentSentenceIndex(target.sentenceIndex);
        const positionMs =
          t.sentences[target.sentenceIndex].startMs + target.offsetMs;
        if (wasPlaying) {
          startSilentRef.current(target.sentenceIndex, positionMs);
        } else {
          clock.set(positionMs);
        }
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
    [clock, ensureElements, loadInto, notifyKeyFailed, pause, setPlayingBoth, stopRaf, tick]
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
