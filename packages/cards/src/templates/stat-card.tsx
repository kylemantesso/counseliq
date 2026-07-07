import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import { fade, fadeUp, msWindow, settle } from "../interpolate";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * stat-card — one oversized statistic. Choreography (mockup 02): kicker
 * fades, the headline settles from 1.16× scale, supporting copy rises,
 * and the sourceLabel footer fades in last. The sourceLabel ALWAYS
 * renders when present — statistic cards must carry their source
 * (compliance invariant).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const StatCard: FC<CardComponentProps<CardPropsFor<"stat-card">>> = ({ props, timing }) => {
  const headline = String(props.headline ?? "");
  // Long headlines (sentence-like stats) scale down from the mockup's 108px.
  const headlineSize = headline.length <= 8 ? 108 : headline.length <= 16 ? 72 : 48;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        padding: "36px 30px 108px",
        color: cssVar("ink"),
        fontFamily: cssVar("fontText"),
      }}
    >
      {props.kicker ? (
        <div
          style={{
            fontFamily: cssVar("fontMono"),
            fontSize: 12,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: cssVar("dim"),
            ...fade(msWindow(timing, 100, 500)),
          }}
        >
          {props.kicker}
        </div>
      ) : null}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
        <div
          style={{
            ...display,
            fontSize: headlineSize,
            lineHeight: 1,
            color: cssVar("accent"),
            ...settle(msWindow(timing, 200, 700)),
          }}
        >
          {headline}
        </div>
        {props.supporting ? (
          <div
            style={{
              fontSize: 21,
              color: cssVar("dim"),
              maxWidth: 240,
              lineHeight: 1.35,
              ...fadeUp(msWindow(timing, 700, 500)),
            }}
          >
            {props.supporting}
          </div>
        ) : null}
      </div>
      {props.sourceLabel ? (
        <div
          data-ciq-source-label=""
          style={{ display: "flex", alignItems: "center", gap: 7, ...fade(msWindow(timing, 1250, 600)) }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: cssVar("accent") }} />
          <span
            style={{
              fontFamily: cssVar("fontMono"),
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: cssVar("dim"),
            }}
          >
            {props.sourceLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
};
