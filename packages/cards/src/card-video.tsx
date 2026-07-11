import { useEffect, useRef, type CSSProperties } from "react";
import { CardImage, useAssetResolver } from "./assets";
import { cssVar } from "./theme/brand-theme-provider";
import type { CardTiming } from "./timing";
import { useMediaMode } from "./media-mode";

/**
 * The video playback primitive (M6). Cards stay pure — this is the ONE
 * whitelisted component (like card-stage.tsx) allowed useRef/useEffect,
 * because a <video> element can only be driven imperatively. It contains
 * NO timers and NO wall-clock reads: every millisecond arrives through
 * `timing.media` (host clock → timing artifact v2 media window), so
 * browser playback and any future frame renderer stay in lockstep.
 *
 * Contract:
 * - muted + playsInline are hard-coded — narration is the ONLY audio.
 * - poster (resolver ref `poster:<assetRef>`) shows until playback starts,
 *   under reduced motion, and wherever no media window exists (static
 *   previews, SETTLED_TIMING).
 * - `positionMs >= durationMs` pauses on the last frame (hold, not loop).
 * - The element is re-seeked only when it drifts past DRIFT_TOLERANCE_MS
 *   from the host clock (scrubs/pauses snap it back; steady playback is
 *   left to the element's own decoder).
 */

const DRIFT_TOLERANCE_MS = 250;

export interface CardVideoProps {
  assetRef?: string;
  alt: string;
  timing: CardTiming;
  style?: CSSProperties;
}

export function CardVideo({ assetRef, alt, timing, style }: CardVideoProps) {
  const resolver = useAssetResolver();
  const mediaMode = useMediaMode();
  const videoUrl = assetRef ? resolver.resolve(assetRef) : null;
  const posterUrl = assetRef ? resolver.resolve(`poster:${assetRef}`) : null;
  const elementRef = useRef<HTMLVideoElement | null>(null);

  if (mediaMode === "static") {
    return <CardImage imageRef={assetRef ? `poster:${assetRef}` : undefined} alt={alt} style={style} />;
  }

  const media = timing.media;
  const playing =
    !timing.reducedMotion &&
    media !== undefined &&
    media.positionMs < media.durationMs;
  const positionMs = media?.positionMs ?? 0;

  // Runs every render — the host re-renders per clock tick, so this IS the
  // playback loop, with zero internal timers. jsdom implements none of the
  // playback API, hence the typeof guards.
  useEffect(() => {
    const el = elementRef.current;
    if (!el || typeof el.play !== "function") return;
    if (!playing) {
      if (!el.paused) el.pause();
      // Snap a poster-state element back to its start; hold a finished
      // video wherever it stopped (last frame).
      if (media === undefined && el.currentTime !== 0) el.currentTime = 0;
      return;
    }
    const driftMs = Math.abs(el.currentTime * 1000 - positionMs);
    if (driftMs > DRIFT_TOLERANCE_MS) {
      el.currentTime = positionMs / 1000;
    }
    if (el.paused) {
      void el.play()?.catch(() => {
        // Autoplay rejection: the poster keeps showing; the next tick
        // retries once the host's user gesture has unlocked playback.
      });
    }
  });

  if (!videoUrl) {
    // Unresolved ref: same themed placeholder discipline as CardImage.
    return <CardImage imageRef={assetRef} alt={alt} style={style} />;
  }

  return (
    <video
      ref={elementRef}
      data-ciq-video=""
      src={videoUrl}
      poster={posterUrl ?? undefined}
      muted
      playsInline
      preload="auto"
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: "cover",
        filter: cssVar("imageFilter"),
        ...style,
      }}
      aria-label={alt}
    />
  );
}
