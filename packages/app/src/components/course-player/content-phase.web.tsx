import { useMemo } from "react";
import { CardRenderer, cssVar, deriveActiveCard } from "@counseliq/cards";
import type { UnitClockStore } from "./clock-store.web";
import { useUnitClock } from "./clock-store.web";
import { CaptionBar } from "./caption-bar.web";
import type { PreviewUnit } from "./types";
import type { UnitAudioControls } from "./use-unit-audio.web";

/**
 * The narrated phase: cards fire on their resolved word anchors as the
 * audio clock advances. Only CardLayer and CaptionBar subscribe to the
 * clock store — the rest of the tree is static at 60fps.
 */

export interface ContentPhaseProps {
  unit: PreviewUnit;
  clock: UnitClockStore;
  audio: UnitAudioControls;
  reducedMotion: boolean;
  onEditSentence?: (narrationId: string) => void;
}

export function ContentPhase({ unit, clock, audio, reducedMotion, onEditSentence }: ContentPhaseProps) {
  const timing = unit.timing ?? null;
  if (!timing) {
    return <AssetsNotReady unit={unit} />;
  }
  return (
    <div style={{ position: "absolute", inset: 0, background: cssVar("bg") }}>
      <CardLayer unit={unit} clock={clock} reducedMotion={reducedMotion} />
      <CaptionBar
        timing={timing}
        clock={clock}
        playing={audio.playing}
        onEditSentence={onEditSentence}
      />
    </div>
  );
}

function CardLayer({
  unit,
  clock,
  reducedMotion,
}: {
  unit: PreviewUnit;
  clock: UnitClockStore;
  reducedMotion: boolean;
}) {
  const clockMs = useUnitClock(clock);
  const timing = unit.timing!;
  const active = deriveActiveCard(timing, clockMs, { reducedMotion });
  const card = active.cardIndex === null ? null : unit.cards[active.cardIndex];
  const idleHeading = useMemo(
    () => unit.concept.replace(/-/g, " "),
    [unit.concept]
  );
  if (!card) {
    // Before the first beat: quiet concept slate (mockup's cNone state).
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "0 28px",
          background: cssVar("bg"),
        }}
      >
        <div
          style={{
            fontFamily: cssVar("fontMono"),
            fontSize: 11,
            letterSpacing: ".2em",
            textTransform: "uppercase",
            color: cssVar("dim"),
          }}
        >
          {idleHeading}
        </div>
        <div style={{ width: 44, height: 3, background: cssVar("accent"), marginTop: 16 }} />
      </div>
    );
  }
  return <CardRenderer template={card.template} props={card.props} timing={active.timing} />;
}

function AssetsNotReady({ unit }: { unit: PreviewUnit }) {
  const label =
    unit.state === "blocked"
      ? "Unit blocked — unresolved pronunciation. Resolve the lexicon entry to synthesise."
      : unit.error
        ? `Synthesis failed: ${unit.error.cause}`
        : "Assets not ready — audio and timing have not been generated for this unit yet.";
  return (
    <div
      data-ciq-assets-not-ready=""
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        background: cssVar("bg"),
        color: cssVar("dim"),
        fontFamily: cssVar("fontText"),
        fontSize: 14,
        lineHeight: 1.5,
        textAlign: "center",
      }}
    >
      {label}
    </div>
  );
}
