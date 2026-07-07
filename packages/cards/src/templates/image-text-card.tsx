import type { CardPropsFor } from "@counseliq/course-schema";
import { CardImage } from "../assets";
import { fade, fadeUp, msWindow } from "../interpolate";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * 18 · image-text-card — top 46% image, text panel below. The schema requires
 * only `text`; optional passthrough `kicker`/`title` strings (the mockup's
 * "Regional campus" / "Bendigo") render when present.
 */

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function ImageTextCard({ props, timing }: CardComponentProps<CardPropsFor<"image-text-card">>) {
  const kicker = optionalString((props as Record<string, unknown>).kicker);
  const title = optionalString((props as Record<string, unknown>).title);

  return (
    <div
      data-ciq-card="image-text-card"
      style={{
        position: "absolute",
        inset: 0,
        background: cssVar("bg"),
        color: cssVar("ink"),
        fontFamily: cssVar("fontText"),
      }}
    >
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "46%", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, ...fade(msWindow(timing, 0, 700)) }}>
          <CardImage imageRef={props.imageRef} alt={title ?? props.text} />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "46%",
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          padding: "30px 30px 108px",
        }}
      >
        {kicker ? (
          <div
            style={{
              fontFamily: cssVar("fontMono"),
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: cssVar("dim"),
              ...fade(msWindow(timing, 400, 500)),
            }}
          >
            {kicker}
          </div>
        ) : null}
        {title ? (
          <div
            style={{
              fontFamily: cssVar("fontDisplay"),
              fontWeight: cssVar("displayWeight") as never,
              textTransform: cssVar("titleCase") as never,
              letterSpacing: cssVar("tracking"),
              fontSize: 42,
              lineHeight: 1.05,
              marginTop: 12,
              ...fadeUp(msWindow(timing, 550, 550)),
            }}
          >
            {title}
          </div>
        ) : null}
        <div
          style={{
            fontSize: 18,
            color: title ? cssVar("dim") : cssVar("ink"),
            lineHeight: 1.5,
            marginTop: 14,
            ...fadeUp(msWindow(timing, 800, 500)),
          }}
        >
          {props.text}
        </div>
      </div>
    </div>
  );
}
