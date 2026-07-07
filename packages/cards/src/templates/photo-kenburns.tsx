import type { CardPropsFor } from "@counseliq/course-schema";
import { CardImage } from "../assets";
import { fadeUp, msWindow, pan, type PanDirection } from "../interpolate";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * 09 · photo-kenburns — full-bleed image with a slow drift across the card's
 * whole active window (driven by `timing.progress`, not an entrance window)
 * and overlay text rising out of the scrim zone. Under reduced motion the
 * image holds a static cover frame with no drift offset.
 */

const PAN_DIRECTIONS: readonly PanDirection[] = ["left", "right", "up", "down"];

/** Loose prop strings (e.g. the fixtures' "in") fall back to a left drift. */
function toPanDirection(value: string | undefined): PanDirection {
  return PAN_DIRECTIONS.includes(value as PanDirection) ? (value as PanDirection) : "left";
}

export function PhotoKenburnsCard({ props, timing }: CardComponentProps<CardPropsFor<"photo-kenburns">>) {
  const direction = toPanDirection(props.panDirection);
  const drift = timing.reducedMotion ? { transform: "scale(1.12)" } : pan(timing.progress, direction);

  return (
    <div
      data-ciq-card="photo-kenburns"
      style={{
        position: "absolute",
        inset: 0,
        background: cssVar("bg"),
        color: cssVar("ink"),
        fontFamily: cssVar("fontText"),
      }}
    >
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <div
          data-ciq-pan=""
          style={{
            position: "absolute",
            left: "-15%",
            top: "-15%",
            width: "130%",
            height: "130%",
            ...drift,
          }}
        >
          <CardImage imageRef={props.imageRef} alt={props.overlayText ?? "photo"} />
        </div>
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
              fontSize: 30,
              lineHeight: 1.18,
              ...fadeUp(msWindow(timing, 700, 600)),
            }}
          >
            {props.overlayText}
          </div>
        </div>
      ) : null}
    </div>
  );
}
