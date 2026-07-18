import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contentEndMsForTiming, type UnitTiming } from "@counseliq/course-schema";
import type { UnitClockStore } from "./clock-store.web";
import { seekTarget, sentenceForClock } from "./timeline-helpers";

export interface UseUnitAudioInput {
  unitId: string | null | undefined;
  timing: UnitTiming | null | undefined;
  urls: ReadonlyMap<string, string>;
  muted: boolean;
  clock: UnitClockStore;
  onEnded?: () => void;
  onError?: (audioKey: string) => void;
}

export interface UnitAudioControls {
  playing: boolean;
  ready: boolean;
  currentSentenceIndex: number;
  play(): void;
  pause(): void;
  skipToSentence(index: number): void;
  replayUnit(): void;
  seekToClockMs(ms: number): void;
}

interface HoldState {
  untilMs: number;
  anchorClockMs: number;
  anchorPerfMs: number;
}

export function useUnitAudio({
  unitId,
  timing,
  urls,
  muted,
  clock,
  onEnded,
  onError,
}: UseUnitAudioInput): UnitAudioControls {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const sentenceRef = useRef(0);
  const holdRef = useRef<HoldState | null>(null);
  const rafRef = useRef<number | null>(null);
  const failedKeyRef = useRef<string | null>(null);
  const notifiedKeyRef = useRef<string | null>(null);

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

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = document.createElement("audio");
      audioRef.current.preload = "auto";
    }
    return audioRef.current;
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const setPlayingState = useCallback((value: boolean) => {
    playingRef.current = value;
    setPlaying(value);
  }, []);

  const loadAudio = useCallback(() => {
    const current = timingRef.current;
    if (!current || failedKeyRef.current === current.unitAudioKey) return null;
    const url = urlsRef.current.get(current.unitAudioKey);
    if (!url) return null;
    const audio = ensureAudio();
    if (audio.src !== url) audio.src = url;
    audio.muted = muted;
    return audio;
  }, [ensureAudio, muted]);

  const requestKey = useCallback((key: string) => {
    if (notifiedKeyRef.current === key) return;
    notifiedKeyRef.current = key;
    onErrorRef.current?.(key);
  }, []);

  const notifyFailed = useCallback((key: string) => {
    failedKeyRef.current = key;
    requestKey(key);
  }, [requestKey]);

  const finishUnit = useCallback(() => {
    const current = timingRef.current;
    if (!current) return;
    clock.set(contentEndMsForTiming(current));
    setPlayingState(false);
    stopRaf();
    onEndedRef.current?.();
  }, [clock, setPlayingState, stopRaf]);

  const tickRef = useRef<() => void>(() => {});
  const tick = useCallback(() => {
    if (!playingRef.current) return;
    const current = timingRef.current;
    if (!current) return;
    const hold = holdRef.current;
    if (hold) {
      const now = hold.anchorClockMs + (performance.now() - hold.anchorPerfMs);
      if (now >= hold.untilMs) {
        holdRef.current = null;
        finishUnit();
        return;
      }
      clock.set(Math.round(now));
    } else if (audioRef.current) {
      const now = Math.round(audioRef.current.currentTime * 1000);
      clock.set(now);
      const index = sentenceForClock(current.sentences, now);
      if (index !== null && index !== sentenceRef.current) {
        sentenceRef.current = index;
        setCurrentSentenceIndex(index);
      }
    }
    rafRef.current = requestAnimationFrame(tickRef.current);
  }, [clock, finishUnit]);
  tickRef.current = tick;

  const startSilentHold = useCallback(
    (fromMs: number) => {
      const current = timingRef.current;
      if (!current) return;
      holdRef.current = {
        untilMs: contentEndMsForTiming(current),
        anchorClockMs: fromMs,
        anchorPerfMs: performance.now(),
      };
      clock.set(Math.round(fromMs));
      stopRaf();
      rafRef.current = requestAnimationFrame(tickRef.current);
    },
    [clock, stopRaf]
  );

  const handleEnded = useCallback(() => {
    const current = timingRef.current;
    if (!current || !playingRef.current) return;
    const last = current.sentences.at(-1);
    startSilentHold(
      Math.max(clock.getSnapshot(), last ? last.startMs + last.durationMs : 0)
    );
  }, [clock, startSilentHold]);

  useEffect(() => {
    const audio = ensureAudio();
    const handleError = () => {
      const current = timingRef.current;
      if (!current) return;
      notifyFailed(current.unitAudioKey);
      if (playingRef.current) startSilentHold(clock.getSnapshot());
    };
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [clock, ensureAudio, handleEnded, notifyFailed, startSilentHold]);

  useEffect(() => {
    audioRef.current?.pause();
    holdRef.current = null;
    sentenceRef.current = 0;
    setCurrentSentenceIndex(0);
    setPlayingState(false);
    stopRaf();
    failedKeyRef.current = null;
    notifiedKeyRef.current = null;
    clock.set(0);
  }, [unitId, timing, clock, setPlayingState, stopRaf]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (!playingRef.current || !holdRef.current) return;
    const audio = loadAudio();
    if (!audio) return;
    audio.currentTime = clock.getSnapshot() / 1000;
    holdRef.current = null;
    void audio.play().catch(() => setPlayingState(false));
    stopRaf();
    rafRef.current = requestAnimationFrame(tickRef.current);
  }, [urls, timing, clock, loadAudio, setPlayingState, stopRaf]);

  useEffect(() => () => {
    stopRaf();
    audioRef.current?.pause();
    audioRef.current?.removeAttribute("src");
  }, [stopRaf]);

  const play = useCallback(() => {
    const current = timingRef.current;
    if (!current || playingRef.current) return;
    setPlayingState(true);
    if (holdRef.current) {
      holdRef.current.anchorClockMs = clock.getSnapshot();
      holdRef.current.anchorPerfMs = performance.now();
      stopRaf();
      rafRef.current = requestAnimationFrame(tickRef.current);
      return;
    }
    const audio = loadAudio();
    if (!audio) {
      requestKey(current.unitAudioKey);
      startSilentHold(clock.getSnapshot());
      return;
    }
    if (audio.currentTime === 0 && clock.getSnapshot() > 0) {
      audio.currentTime = clock.getSnapshot() / 1000;
    }
    void audio.play().catch(() => setPlayingState(false));
    stopRaf();
    rafRef.current = requestAnimationFrame(tickRef.current);
  }, [clock, loadAudio, requestKey, setPlayingState, startSilentHold, stopRaf]);

  const pause = useCallback(() => {
    setPlayingState(false);
    audioRef.current?.pause();
    stopRaf();
  }, [setPlayingState, stopRaf]);

  const seekToClockMs = useCallback(
    (ms: number) => {
      const current = timingRef.current;
      if (!current) return;
      const target = seekTarget(current.sentences, ms);
      if (!target) {
        pause();
        clock.set(Math.min(contentEndMsForTiming(current), Math.max(0, ms)));
        return;
      }
      const wasPlaying = playingRef.current;
      const positionMs = current.sentences[target.sentenceIndex].startMs + target.offsetMs;
      holdRef.current = null;
      sentenceRef.current = target.sentenceIndex;
      setCurrentSentenceIndex(target.sentenceIndex);
      clock.set(positionMs);
      const audio = loadAudio();
      if (!audio) {
        requestKey(current.unitAudioKey);
        if (wasPlaying) startSilentHold(positionMs);
        return;
      }
      audio.currentTime = positionMs / 1000;
      if (wasPlaying) {
        void audio.play().catch(() => setPlayingState(false));
        stopRaf();
        rafRef.current = requestAnimationFrame(tickRef.current);
      } else {
        audio.pause();
      }
    },
    [clock, loadAudio, pause, requestKey, setPlayingState, startSilentHold, stopRaf]
  );

  const skipToSentence = useCallback(
    (index: number) => {
      const current = timingRef.current;
      if (!current) return;
      const clamped = Math.min(current.sentences.length - 1, Math.max(0, index));
      seekToClockMs(current.sentences[clamped].startMs);
    },
    [seekToClockMs]
  );

  const replayUnit = useCallback(() => skipToSentence(0), [skipToSentence]);
  const ready = useMemo(
    () => Boolean(timing && urls.has(timing.unitAudioKey)),
    [timing, urls]
  );

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
