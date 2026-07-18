import { useEffect, useMemo, useRef } from "react";
import {
  AvatarOverlayCard,
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
  /** Persisted HeyGen avatar footage, resolved through the object store. */
  avatarVideoUrl?: string;
  onEditSentence?: (narrationId: string) => void;
}

export function ContentPhase({
  unit,
  clock,
  audio,
  reducedMotion,
  institutionLogoUrl,
  avatarVideoUrl,
  onEditSentence,
}: ContentPhaseProps) {
  const timing = unit.timing ?? null;
  if (!timing) {
    return <AssetsNotReady unit={unit} />;
  }
  return (
    <div style={{ position: "absolute", inset: 0, background: avatarVideoUrl ? "#000000" : cssVar("bg") }}>
      {avatarVideoUrl ? <AvatarVideoLayer url={avatarVideoUrl} clock={clock} playing={audio.playing} /> : null}
      <CardLayer
        unit={unit}
        clock={clock}
        reducedMotion={reducedMotion}
        institutionLogoUrl={institutionLogoUrl}
        avatarVideoUrl={avatarVideoUrl}
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
  avatarVideoUrl,
}: {
  unit: PreviewUnit;
  clock: UnitClockStore;
  reducedMotion: boolean;
  institutionLogoUrl?: string | null;
  avatarVideoUrl?: string;
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
    if (avatarVideoUrl) return null;
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

  const cardView =
    avatarVideoUrl && card.visualTreatment === "avatar-overlay" ? (
      <>
        <style>{AVATAR_OVERLAY_VIDEO_CSS}</style>
        <AvatarOverlayCard template={card.template} props={cardProps} timing={active.timing} />
      </>
    ) : (
      <div
        style={
          avatarVideoUrl
            ? { position: "absolute", inset: 0, background: cssVar("bg") }
            : undefined
        }
      >
        <CardRenderer template={card.template} props={cardProps} timing={active.timing} />
      </div>
    );

  const swap = deriveCardSwapTransition(timing, clockMs, reducedMotion);
  if (!swap || swap.toCardIndex !== active.cardIndex) {
    return cardView;
  }

  const previousCard = unit.cards[swap.fromCardIndex];
  if (!previousCard) {
    return cardView;
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
      {cardView}
    </div>
  );
}

const AVATAR_OVERLAY_VIDEO_CSS = `
  [data-ciq-avatar-overlay-card] { background: transparent !important; }
  [data-ciq-avatar-overlay-card] > img,
  [data-ciq-avatar-overlay-card] > [data-ciq-image-placeholder],
  [data-ciq-avatar-overlay-card] > [data-ciq-video] { display: none !important; }
`;

function AvatarVideoLayer({
  url,
  clock,
  playing,
}: {
  url: string;
  clock: UnitClockStore;
  playing: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const clockMs = useUnitClock(clock);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const targetSeconds = Math.max(0, clockMs / 1000);
    // Seek only after a meaningful drift so normal playback stays smooth.
    if (Math.abs(video.currentTime - targetSeconds) > 0.15) {
      video.currentTime = targetSeconds;
    }
  }, [clockMs]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (playing) {
      void video.play().catch(() => {
        // The player controls initiated audio playback; if this video is
        // blocked, the card sequence and narration remain reviewable.
      });
    } else {
      video.pause();
    }
  }, [playing]);

  return (
    <video
      ref={ref}
      src={url}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
    />
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
