import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import type { CardComponentProps } from "../timing";
import { fade, fadeUp, msWindow } from "../interpolate";
import { fitDisplayFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";

/**
 * date-card — a single key date. Adapted from the mockup's key-dates rows:
 * kicker fades (100ms), the date lands big in display type (200ms), the
 * label row rises between rules (500ms).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const DateCard: FC<CardComponentProps<CardPropsFor<"date-card">>> = ({ props, timing }) => {
  return (
    <div
      data-ciq-card="date-card"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        padding: "36px 30px 108px",
        background: cssVar("bg"),
        color: cssVar("ink"),
        fontFamily: cssVar("fontText"),
      }}
    >
      <div
        style={{
          fontFamily: cssVar("fontMono"),
          fontSize: 12,
          letterSpacing: ".22em",
          textTransform: "uppercase",
          color: cssVar("dim"),
          ...fade(msWindow(timing, 100, 500)),
        }}
      >
        Key date
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div
          style={{
            ...display,
            fontSize: fitDisplayFontSize(props.date, 44),
            overflowWrap: "break-word",
            lineHeight: 1.05,
            color: cssVar("accent"),
            ...fadeUp(msWindow(timing, 200, 500)),
          }}
        >
          {props.date}
        </div>
        {props.label ? (
          <div
            style={{
              marginTop: 30,
              padding: "16px 0",
              borderTop: `1px solid ${cssVar("rule")}`,
              borderBottom: `1px solid ${cssVar("rule")}`,
              ...fadeUp(msWindow(timing, 500, 450)),
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.35 }}>{props.label}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
