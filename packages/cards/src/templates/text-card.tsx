import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import type { CardComponentProps } from "../timing";
import { fade, fadeUp, msWindow } from "../interpolate";
import { cssVar } from "../theme/brand-theme-provider";

/**
 * text-card — generic statement card. Mockup choreography: kicker fades
 * (100ms), body rises centered (300ms).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const TextCard: FC<CardComponentProps<CardPropsFor<"text-card">>> = ({ props, timing }) => {
  return (
    <div
      data-ciq-card="text-card"
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
      {props.heading ? (
        <div
          style={{
            fontFamily: cssVar("fontMono"),
            fontSize: 12,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: cssVar("accent"),
            ...fade(msWindow(timing, 100, 500)),
          }}
        >
          {props.heading}
        </div>
      ) : null}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div
          style={{
            ...display,
            fontSize: 33,
            lineHeight: 1.3,
            ...fadeUp(msWindow(timing, 300, 550)),
          }}
        >
          {props.body}
        </div>
      </div>
    </div>
  );
};
