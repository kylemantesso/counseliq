import type { CardPropsFor } from "@counseliq/course-schema";
import { CardVideo } from "../card-video";
import { fadeUp, msWindow } from "../interpolate";
import { fitBlockFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * 22 · video-card — full-bleed muted b-roll (M6). Playback is driven by the
 * host clock through `timing.media` (CardVideo, the whitelisted playback
 * primitive — no internal timers, ever): poster until the beat fires,
 * play within the media window, hold the last frame when the clip is
 * shorter than the card, poster still under reduced motion. Narration
 * remains the only audio — the video element is muted by contract.
 */

export function VideoCard({ props, timing }: CardComponentProps<CardPropsFor<"video-card">>) {
  return (
    <div
      data-ciq-card="video-card"
      style={{
        position: "absolute",
        inset: 0,
        background: cssVar("bg"),
        color: cssVar("ink"),
        fontFamily: cssVar("fontText"),
      }}
    >
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <CardVideo
          assetRef={props.assetRef}
          alt={props.overlayText ?? "video"}
          timing={timing}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "55%",
            background: `linear-gradient(to top, ${cssVar("scrim")}, rgba(0,0,0,0))`,
          }}
        />
      </div>
      {props.overlayText ? (
        <div style={{ position: "absolute", left: 30, right: 30, bottom: 108, color: cssVar("photoInk") }}>
          <div
            style={{
              fontFamily: cssVar("fontDisplay"),
              fontWeight: cssVar("displayWeight") as never,
              textTransform: cssVar("titleCase") as never,
              letterSpacing: cssVar("tracking"),
              // Overlay grows upward from the scrim zone; keep it inside it.
              fontSize: fitBlockFontSize(props.overlayText, 30, {
                maxHeightPx: 240,
                lineHeight: 1.18,
              }),
              overflowWrap: "break-word",
              lineHeight: 1.18,
              ...fadeUp(msWindow(timing, 700, 600)),
            }}
          >
            {props.overlayText}
          </div>
        </div>
      ) : null}
      {props.sourceLabel ? (
        <div
          data-ciq-source-label=""
          style={{
            position: "absolute",
            left: 30,
            right: 30,
            bottom: 82,
            display: "flex",
            alignItems: "flex-start",
            gap: 7,
            color: cssVar("photoInk"),
            ...fadeUp(msWindow(timing, 900, 500)),
          }}
        >
          <span
            style={{
              flex: "0 0 auto",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: cssVar("accent"),
              marginTop: 4,
            }}
          />
          <span
            style={{
              fontFamily: cssVar("fontMono"),
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              lineHeight: 1.5,
              opacity: 0.85,
            }}
          >
            {props.sourceLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}
