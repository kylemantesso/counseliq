import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import type { CardComponentProps } from "../timing";
import { fade, fadeUp, growX, msWindow, settle } from "../interpolate";
import { cssVar } from "../theme/brand-theme-provider";

/**
 * term-card — key-term definition. Mockup choreography: kicker fades
 * (100ms), the term settles in oversized display type (200ms, kSettle),
 * accent bar grows (700ms), definition rises (850ms).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

/** Long terms scale down so they stay on the 360px canvas. */
function termFontSize(term: string): number {
  if (term.length > 14) return 40;
  if (term.length > 8) return 60;
  return 92;
}

export const TermCard: FC<CardComponentProps<CardPropsFor<"term-card">>> = ({ props, timing }) => {
  return (
    <div
      data-ciq-card="term-card"
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
        Key term
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div
          style={{
            ...display,
            fontSize: termFontSize(props.term),
            lineHeight: 1,
            overflowWrap: "break-word",
            ...settle(msWindow(timing, 200, 700)),
          }}
        >
          {props.term}
        </div>
        <div
          style={{
            width: 44,
            height: 3,
            background: cssVar("accent"),
            margin: "26px 0 24px",
            ...growX(msWindow(timing, 700, 500)),
          }}
        />
        <div
          style={{
            fontSize: 17,
            color: cssVar("dim"),
            lineHeight: 1.5,
            maxWidth: 270,
            ...fadeUp(msWindow(timing, 850, 500)),
          }}
        >
          {props.definition}
        </div>
      </div>
    </div>
  );
};
