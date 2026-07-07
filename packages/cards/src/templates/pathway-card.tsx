import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import { beatProgress, fade, fadeUp, growY, msWindow } from "../interpolate";
import { fitDisplayFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * pathway-card — sequential stages joined by connectors (mockup 11).
 * Stage i rises on `beatProgress(timing, i)`; the connector into stage
 * i+1 grows with that next beat, so the path draws itself stage by
 * stage. The final stage carries the accent border (the destination).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const PathwayCard: FC<CardComponentProps<CardPropsFor<"pathway-card">>> = ({ props, timing }) => {
  const stages = Array.isArray(props.stages) ? props.stages : [];
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
      {props.heading ? (
        <div
          style={{
            ...display,
            fontSize: fitDisplayFontSize(props.heading, 34),
            overflowWrap: "break-word",
            lineHeight: 1.1,
            ...fadeUp(msWindow(timing, 100, 500)),
          }}
        >
          {props.heading}
        </div>
      ) : null}
      <div style={{ marginTop: 30, display: "flex", flexDirection: "column", alignItems: "stretch" }}>
        {stages.map((stage, i) => {
          const last = i === stages.length - 1;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}>
              {i > 0 ? (
                <div
                  style={{
                    alignSelf: "center",
                    width: 2,
                    height: 22,
                    background: cssVar("accent"),
                    ...growY(beatProgress(timing, i)),
                  }}
                />
              ) : null}
              <div
                data-ciq-beat-item={i}
                style={{
                  border: last ? `2px solid ${cssVar("accent")}` : `1px solid ${cssVar("rule")}`,
                  borderRadius: cssVar("radius"),
                  padding: "16px 18px",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 14,
                  ...fadeUp(beatProgress(timing, i)),
                }}
              >
                <span style={{ fontFamily: cssVar("fontMono"), fontSize: 11, color: cssVar("accent") }}>
                  {i + 1}
                </span>
                <div style={{ fontSize: 19, fontWeight: 600 }}>{stage}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      {props.note ? (
        <div
          style={{
            fontSize: 15,
            color: cssVar("dim"),
            ...fade(beatProgress(timing, stages.length)),
          }}
        >
          {props.note}
        </div>
      ) : null}
    </div>
  );
};
