"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AssetResolverContext,
  BrandThemeProvider,
  CardStage,
  brandThemeFromTokens,
  type AssetResolver,
} from "@counseliq/cards";
import { createUnitClock, useUnitClock, type UnitClockStore } from "./clock-store.web";
import { ModuleRail } from "./module-rail.web";
import { PlayerControls } from "./player-controls.web";
import {
  courseProgressPct,
  flattenUnits,
  mediaKeysForUnits,
  phaseFraction,
  resolveAssetUrl,
} from "./timeline-helpers";
import type { PreviewQuestion, RunPreviewData, UnitPhase } from "./types";
import { UnitFlow, useUnitFlow } from "./unit-flow.web";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion.web";
import { useUnitAudio } from "./use-unit-audio.web";

/**
 * The course player — gate-3's studio playback surface. Left: module rail
 * (click any unit). Right: the 9:16 stage under the institution theme, with
 * phase pills, transport controls, and the audio-driven clock. The audio
 * element is the only clock; cards fire on their resolved word anchors.
 *
 * URL plumbing stays with the host: the player announces the audioKeys it
 * needs via onRequestUrls and consumes whatever presignedUrls contains.
 */

export interface CoursePlayerProps {
  data: RunPreviewData;
  /** audioKey → presigned URL (host-owned; grows as requests resolve). */
  presignedUrls: ReadonlyMap<string, string>;
  /** Called with audioKeys the player needs but presignedUrls lacks. */
  onRequestUrls?: (audioKeys: string[]) => void;
  /** E5: sentence edit affordance (paused captions + side panels). */
  onEditSentence?: (unitId: string, narrationId: string) => void;
}

export function CoursePlayer({
  data,
  presignedUrls,
  onRequestUrls,
  onEditSentence,
}: CoursePlayerProps) {
  const flatUnits = useMemo(() => flattenUnits(data.modules), [data.modules]);
  const [flatIndex, setFlatIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const clock = useMemo(() => createUnitClock(), []);
  const reducedMotion = usePrefersReducedMotion();

  const current = flatUnits[Math.min(flatIndex, flatUnits.length - 1)] ?? null;
  const unit = current?.unit ?? null;

  const questionsById = useMemo(() => {
    const map = new Map<string, PreviewQuestion>();
    for (const q of data.questions) map.set(q.id, q);
    return map;
  }, [data.questions]);

  const selectUnit = useCallback(
    (index: number) => {
      setFlatIndex(Math.min(flatUnits.length - 1, Math.max(0, index)));
    },
    [flatUnits.length]
  );

  const onUnitComplete = useCallback(() => {
    if (flatIndex + 1 < flatUnits.length) setFlatIndex(flatIndex + 1);
  }, [flatIndex, flatUnits.length]);

  const flow = useUnitFlow(unit ?? EMPTY_UNIT, onUnitComplete);

  const audio = useUnitAudio({
    timing: unit?.timing ?? null,
    urls: presignedUrls,
    muted,
    clock,
    onEnded: () => {
      if (flow.phase === "content") flow.advance();
    },
    onError: (audioKey) => onRequestUrls?.([audioKey]),
  });

  // Announce missing URLs for the current + next unit's sentences AND media
  // assets (video/image bytes + posters) — the next unit's media preloads
  // through the same seam as its audio.
  const lastRequestedRef = useRef<string>("");
  useEffect(() => {
    if (!onRequestUrls) return;
    const adjacent = [flatUnits[flatIndex], flatUnits[flatIndex + 1]];
    const wanted: string[] = [];
    for (const f of adjacent) {
      for (const s of f?.unit.timing?.sentences ?? []) {
        if (!presignedUrls.has(s.audioKey)) wanted.push(s.audioKey);
      }
    }
    for (const key of mediaKeysForUnits(
      adjacent.map((f) => f?.unit),
      data.assets
    )) {
      if (!presignedUrls.has(key)) wanted.push(key);
    }
    if (wanted.length === 0) return;
    const signature = wanted.join("|");
    if (signature === lastRequestedRef.current) return;
    lastRequestedRef.current = signature;
    onRequestUrls(wanted);
  }, [flatUnits, flatIndex, presignedUrls, onRequestUrls, data.assets]);

  // assetRef → presigned URL resolution for the cards package (M6). URLs
  // are never logged; unresolved refs render themed placeholders.
  const assetResolver = useMemo<AssetResolver>(
    () => ({
      resolve: (ref) => resolveAssetUrl(ref, data.assets, presignedUrls),
    }),
    [data.assets, presignedUrls]
  );

  if (!unit || !current) {
    return <div style={{ padding: 24, color: "#9aa3ad" }}>No units to preview.</div>;
  }

  const theme = brandThemeFromTokens(data.institution.brandTokens);

  return (
    <div
      data-ciq-course-player=""
      style={{
        display: "flex",
        height: "100%",
        minHeight: 560,
        background: "#111418",
        color: "#e8e6e1",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <ModuleRail
        modules={data.modules}
        flatUnits={flatUnits}
        activeFlatIndex={current.flatIndex}
        onSelectUnit={selectUnit}
      />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          padding: "16px 20px",
          overflowY: "auto",
        }}
      >
        <TopChrome
          data={data}
          moduleTitle={current.module.moduleTitle}
          unitKey={unit.unitKey}
          flatIndex={current.flatIndex}
          totalUnits={flatUnits.length}
          phase={flow.phase}
          clock={clock}
          totalDurationMs={unit.timing?.totalDurationMs ?? 0}
        />
        <PhasePills flow={flow} />
        <div style={{ width: "min(360px, 100%)", aspectRatio: "360 / 640", flex: "0 0 auto" }}>
          <AssetResolverContext.Provider value={assetResolver}>
            <BrandThemeProvider theme={theme}>
              <CardStage>
                <UnitFlow
                  unit={unit}
                  flow={flow}
                  questionsById={questionsById}
                  clock={clock}
                  audio={audio}
                  reducedMotion={reducedMotion}
                  isLastUnit={current.flatIndex === flatUnits.length - 1}
                  onEditSentence={
                    onEditSentence
                      ? (narrationId) => onEditSentence(unit.id, narrationId)
                      : undefined
                  }
                />
              </CardStage>
            </BrandThemeProvider>
          </AssetResolverContext.Provider>
        </div>
        {flow.phase === "content" && unit.timing ? (
          <div style={{ width: "min(420px, 100%)" }}>
            <PlayerControls
              timing={unit.timing}
              clock={clock}
              playing={audio.playing}
              muted={muted}
              onPlayPause={() => (audio.playing ? audio.pause() : audio.play())}
              onSkipSentence={() => audio.skipToSentence(audio.currentSentenceIndex + 1)}
              onReplayUnit={audio.replayUnit}
              onToggleMute={() => setMuted((m) => !m)}
              onSeek={audio.seekToClockMs}
              onPrevUnit={current.flatIndex > 0 ? () => selectUnit(current.flatIndex - 1) : undefined}
              onNextUnit={
                current.flatIndex + 1 < flatUnits.length
                  ? () => selectUnit(current.flatIndex + 1)
                  : undefined
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const EMPTY_UNIT = {
  id: "",
  unitKey: "",
  concept: "",
  state: "draft" as const,
  narration: [],
  cards: [],
  meta: {},
};

/** Top progress bar + labels, ported from the mockup chrome. */
function TopChrome({
  data,
  moduleTitle,
  unitKey,
  flatIndex,
  totalUnits,
  phase,
  clock,
  totalDurationMs,
}: {
  data: RunPreviewData;
  moduleTitle: string;
  unitKey: string;
  flatIndex: number;
  totalUnits: number;
  phase: UnitPhase;
  clock: UnitClockStore;
  totalDurationMs: number;
}) {
  const clockMs = useUnitClock(clock);
  const contentProgress = totalDurationMs > 0 ? clockMs / totalDurationMs : 0;
  const pct = courseProgressPct(flatIndex, totalUnits, phaseFraction(phase, contentProgress));
  return (
    <div style={{ width: "100%", maxWidth: 560 }}>
      <div style={{ height: 3, background: "#262b31", borderRadius: 2 }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "#2f6feb",
            borderRadius: 2,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 9.5,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: "#9aa3ad",
        }}
      >
        <span>
          {data.course.title} — {moduleTitle}
        </span>
        <span>
          {unitKey} · {flatIndex + 1}/{totalUnits}
        </span>
      </div>
    </div>
  );
}

/** Studio phase navigation: every phase of the unit, one click away. */
function PhasePills({ flow }: { flow: ReturnType<typeof useUnitFlow> }) {
  return (
    <div role="tablist" aria-label="Unit phases" style={{ display: "flex", gap: 6 }}>
      {flow.phases.map((phase) => {
        const active = phase === flow.phase;
        return (
          <button
            key={phase}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => flow.setPhase(phase)}
            style={{
              border: `1px solid ${active ? "#2f6feb" : "#3a4048"}`,
              borderRadius: 999,
              background: active ? "#20262d" : "transparent",
              color: active ? "#e8e6e1" : "#9aa3ad",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              padding: "5px 12px",
              cursor: "pointer",
            }}
          >
            {phase}
          </button>
        );
      })}
    </div>
  );
}
