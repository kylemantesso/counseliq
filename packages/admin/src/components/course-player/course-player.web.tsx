"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AssetResolverContext,
  BrandThemeProvider,
  CardStage,
  brandThemeFromTokens,
  type AssetResolver,
} from "@counseliq/cards";
import { contentEndMsForTiming } from "@counseliq/course-schema";
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
import type { PreviewQuestion, PreviewUnit, RunPreviewData, UnitPhase } from "./types";
import { UnitFlow, useUnitFlow } from "./unit-flow.web";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion.web";
import { useUnitAudio } from "./use-unit-audio.web";
import { GoogleBrandFontLoader } from "../theme/google-brand-font-loader.web";
import { logoUrlFromBrandTokens } from "../../theme/brand-tokens";

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
  /** Optional always-visible right rail inside the studio surface. */
  rightRail?: ReactNode;
  /** Optional review chrome rendered above the three-column studio body. */
  studioHeader?: ReactNode;
  /** Announces active unit changes (selection, autoplay next, etc). */
  onActiveUnitChange?: (unitId: string) => void;
  /** Downloads all synthesized narration MP3s for the active unit. */
  onDownloadNarration?: (unit: PreviewUnit) => void;
  downloadingNarration?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function CoursePlayer({
  data,
  presignedUrls,
  onRequestUrls,
  onEditSentence,
  rightRail,
  studioHeader,
  onActiveUnitChange,
  onDownloadNarration,
  downloadingNarration = false,
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

  useEffect(() => {
    if (unit) onActiveUnitChange?.(unit.id);
  }, [onActiveUnitChange, unit]);

  if (!unit || !current) {
    return <div style={{ padding: 24, color: "#9aa3ad" }}>No units to preview.</div>;
  }

  const themeTokens =
    isRecord(data.institution.brandTokens) && data.course.brandRef
      ? {
          ...data.institution.brandTokens,
          brandRef: data.course.brandRef,
        }
      : data.institution.brandTokens ??
        (data.course.brandRef ? { brandRef: data.course.brandRef } : undefined);
  const theme = brandThemeFromTokens(themeTokens);
  const institutionLogoUrl = logoUrlFromBrandTokens(themeTokens);

  return (
    <>
      <GoogleBrandFontLoader fontFamilies={[theme.fontDisplay, theme.fontText, theme.fontMono]} />
      <div
      data-ciq-course-player=""
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 620,
        background: "#090d12",
        color: "#e8e6e1",
        borderRadius: 0,
        overflow: "hidden",
      }}
      >
      {studioHeader ? <div style={{ flex: "0 0 auto" }}>{studioHeader}</div> : null}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <ModuleRail
          modules={data.modules}
          flatUnits={flatUnits}
          activeFlatIndex={current.flatIndex}
          onSelectUnit={selectUnit}
        />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            padding: "24px 28px 18px",
            overflowY: "auto",
            background:
              "radial-gradient(circle at 50% 10%, rgba(32, 48, 68, .38), transparent 34%), #0b0f14",
          }}
        >
          <TopChrome
            data={data}
            moduleTitle={current.module.moduleTitle}
            unitLabel={`${current.moduleIndex + 1}.${current.unitIndexInModule + 1}`}
            flatIndex={current.flatIndex}
            totalUnits={flatUnits.length}
            phase={flow.phase}
            clock={clock}
            totalDurationMs={unit.timing ? contentEndMsForTiming(unit.timing) : 0}
            phasePills={<PhasePills flow={flow} />}
          />
          <div
            style={{
              width: "min(360px, 44vh, 100%)",
              minWidth: 280,
              aspectRatio: "360 / 640",
              flex: "0 0 auto",
              borderRadius: 28,
              boxShadow: "0 26px 80px rgba(0,0,0,.34)",
            }}
          >
            <AssetResolverContext.Provider value={assetResolver}>
              <BrandThemeProvider theme={theme}>
                <CardStage style={{ borderRadius: 28 }}>
                  <UnitFlow
                    unit={unit}
                    flow={flow}
                    questionsById={questionsById}
                    clock={clock}
                    audio={audio}
                    reducedMotion={reducedMotion}
                    institutionLogoUrl={institutionLogoUrl}
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
            <div style={{ width: "min(440px, 100%)" }}>
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
                onDownloadNarration={
                  unit.timing && onDownloadNarration
                    ? () => onDownloadNarration(unit)
                    : undefined
                }
                downloadingNarration={downloadingNarration}
              />
            </div>
          ) : null}
        </div>
        {rightRail ? (
          <aside
            style={{
              width: 390,
              flex: "0 0 auto",
              borderLeft: "1px solid #202833",
              background: "#0c1117",
              overflowY: "auto",
            }}
          >
            {rightRail}
          </aside>
        ) : null}
      </div>
      </div>
    </>
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
  unitLabel,
  flatIndex,
  totalUnits,
  phase,
  clock,
  totalDurationMs,
  phasePills,
}: {
  data: RunPreviewData;
  moduleTitle: string;
  unitLabel: string;
  flatIndex: number;
  totalUnits: number;
  phase: UnitPhase;
  clock: UnitClockStore;
  totalDurationMs: number;
  phasePills: ReactNode;
}) {
  const clockMs = useUnitClock(clock);
  const contentProgress = totalDurationMs > 0 ? clockMs / totalDurationMs : 0;
  const pct = courseProgressPct(flatIndex, totalUnits, phaseFraction(phase, contentProgress));
  return (
    <div style={{ width: "100%", maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "#f4f1e8", fontSize: 18, fontWeight: 800, lineHeight: 1.1 }}>
            {data.modules.length > 0 ? moduleTitle : data.course.title}
          </div>
          <div
            style={{
              marginTop: 4,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9.5,
              letterSpacing: ".08em",
              color: "#7f8792",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Unit {unitLabel} · {moduleTitle} · {flatIndex + 1}/{totalUnits}
          </div>
        </div>
        {phasePills}
      </div>
      <div
        style={{
          height: 2,
          marginTop: 14,
          background: "#1d252f",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div style={{ height: "100%", width: `${pct}%`, background: "#d6ad2f" }} />
      </div>
    </div>
  );
}

/** Studio phase navigation: every phase of the unit, one click away. */
function PhasePills({ flow }: { flow: ReturnType<typeof useUnitFlow> }) {
  return (
    <div role="tablist" aria-label="Unit phases" style={{ display: "flex", gap: 4, flex: "0 0 auto" }}>
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
              border: `1px solid ${active ? "#d6ad2f" : "#303844"}`,
              borderRadius: 999,
              background: active ? "#d6ad2f" : "#111821",
              color: active ? "#11100c" : "#8d96a3",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10.5,
              fontWeight: active ? 800 : 600,
              padding: "6px 11px",
              cursor: "pointer",
            }}
          >
            {phase === "hook" ? "✓ Hook" : phase === "content" ? "Content" : phase === "retrieve" ? "+ Retrieve" : "+ Anchor"}
          </button>
        );
      })}
    </div>
  );
}
