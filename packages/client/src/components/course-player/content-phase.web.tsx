import { useMemo } from "react";
import {
  CardRenderer,
  cssVar,
  deriveActiveCard,
  easeOut,
} from "@counseliq/cards";
import type { UnitClockStore } from "./clock-store.web";
import { useUnitClock } from "./clock-store.web";
import { CaptionBar } from "./caption-bar.web";
import type { PreviewUnit } from "./types";
import type { UnitAudioControls } from "./use-unit-audio.web";
import { withInstitutionLogoOnTitleCard } from "../../theme/brand-tokens";
import {
  deriveCardSwapTransition,
  pickCardTransitionVariant,
  type CardTransitionVariant,
} from "./timeline-helpers";

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
  institutionLogoUrl?: string | null;
  onEditSentence?: (narrationId: string) => void;
}

export function ContentPhase({
  unit,
  clock,
  audio,
  reducedMotion,
  institutionLogoUrl,
  onEditSentence,
}: ContentPhaseProps) {
  const timing = unit.timing ?? null;
  if (!timing) {
    return <AssetsNotReady unit={unit} />;
  }
  return (
    <div style={{ position: "absolute", inset: 0, background: cssVar("bg") }}>
      <CardLayer
        unit={unit}
        clock={clock}
        reducedMotion={reducedMotion}
        institutionLogoUrl={institutionLogoUrl}
      />
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
  institutionLogoUrl,
}: {
  unit: PreviewUnit;
  clock: UnitClockStore;
  reducedMotion: boolean;
  institutionLogoUrl?: string | null;
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
  const cardProps = withInstitutionLogoOnTitleCard(
    card.template,
    card.props,
    institutionLogoUrl
  );

  const swap = deriveCardSwapTransition(timing, clockMs, reducedMotion);
  if (!swap || swap.toCardIndex !== active.cardIndex) {
    return <CardRenderer template={card.template} props={cardProps} timing={active.timing} />;
  }

  const previousCard = unit.cards[swap.fromCardIndex];
  if (!previousCard) {
    return <CardRenderer template={card.template} props={cardProps} timing={active.timing} />;
  }
  const variant = pickCardTransitionVariant({
    unitId: unit.id,
    fromCardIndex: swap.fromCardIndex,
    toCardIndex: swap.toCardIndex,
    fromCard: previousCard,
    toCard: card,
  });
  const transitionStyle = transitionLayerStyle(variant, swap.progress);

  return (
    <div style={{ position: "absolute", inset: 0, ...transitionStyle }}>
      <CardRenderer template={card.template} props={cardProps} timing={active.timing} />
    </div>
  );
}

function transitionLayerStyle(
  variant: CardTransitionVariant,
  progress: number
): { opacity?: number; transform?: string; transformOrigin?: string } {
  const t = Math.min(1, Math.max(0, progress));
  const eased = easeOut(t);
  switch (variant) {
    case "lift":
      return {
        transform: `translateY(${(1 - eased) * 12}px)`,
      };
    case "zoom":
      return {
        transform: `scale(${0.985 + 0.015 * eased})`,
        transformOrigin: "center center",
      };
    case "fade":
      return {
        opacity: 0.94 + 0.06 * eased,
      };
  }
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
