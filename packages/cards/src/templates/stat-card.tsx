import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import { fade, fadeUp, msWindow, settle } from "../interpolate";
import { visibleSourceLabels } from "../source-labels";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";
import { BackgroundMediaLayer } from "../background-media";

/**
 * stat-card — one oversized statistic. Choreography (mockup 02): kicker
 * fades, the headline settles from 1.16× scale, supporting copy rises,
 * and the sourceLabel footer fades in last. Real citations always render
 * (statistic cards must carry their source — compliance invariant lives
 * in the PROPS); provenance-class markers like "Institution claim" are
 * display-filtered via visibleSourceLabels.
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const StatCard: FC<CardComponentProps<CardPropsFor<"stat-card">>> = ({ props, timing }) => {
  const [sourceLabel] = visibleSourceLabels(props.sourceLabel as string | undefined);
  const headline = String(props.headline ?? "");
  // Width-aware sizing: the inner column is 300px (360 − 2×30 padding) and
  // display digits/caps run ~0.62em wide, so size from the character count
  // rather than fixed length buckets — "70,000" at the mockup's 108px would
  // bleed past the card edge. Clamped to [40, 108]; long sentence-like
  // headlines wrap at the floor size.
  const headlineSize = Math.max(
    40,
    Math.min(108, Math.floor(300 / (0.62 * Math.max(1, headline.length))))
  );
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        padding: "36px 30px 108px",
        overflow: "hidden",
        color: cssVar("ink"),
        fontFamily: cssVar("fontText"),
      }}
    >
      <BackgroundMediaLayer
        assetRef={props.bgAssetRef}
        treatment={props.bgTreatment}
      />
      {props.kicker ? (
        <div
          style={{
            position: "relative",
            zIndex: 1,
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
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            ...display,
            fontSize: headlineSize,
            lineHeight: 1.05,
            overflowWrap: "break-word",
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
      {sourceLabel ? (
        <div
          data-ciq-source-label=""
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            alignItems: "flex-start",
            gap: 7,
            ...fade(msWindow(timing, 1250, 600)),
          }}
        >
          <span
            style={{
              flex: "0 0 auto",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: cssVar("accent"),
              // Optically align with the first text line's cap height.
              marginTop: 4,
            }}
          />
          <span
            style={{
              fontFamily: cssVar("fontMono"),
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: cssVar("dim"),
            }}
          >
            {sourceLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
};
