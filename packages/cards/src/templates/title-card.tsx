import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import type { CardComponentProps } from "../timing";
import { fade, fadeUp, growX, msWindow } from "../interpolate";
import { fitDisplayFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";

/**
 * title-card — module/section opener. Mockup choreography: kicker fades in
 * (100ms), accent bar grows (300ms), title rises (350ms), footer fades
 * (700ms).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const TitleCard: FC<CardComponentProps<CardPropsFor<"title-card">>> = ({ props, timing }) => {
  return (
    <div
      data-ciq-card="title-card"
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
      {props.kicker ? (
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
          {props.kicker}
        </div>
      ) : null}
      <div
        style={{
          width: 44,
          height: 3,
          background: cssVar("accent"),
          margin: "22px 0 26px",
          ...growX(msWindow(timing, 300, 500)),
        }}
      />
      <div
        style={{
          ...display,
          fontSize: fitDisplayFontSize(props.title, 47),
          lineHeight: 1.08,
          overflowWrap: "break-word",
          ...fadeUp(msWindow(timing, 350, 500)),
        }}
      >
        {props.title}
      </div>
      <div style={{ flex: 1 }} />
      {props.courseLabel ? (
        <div
          style={{
            borderTop: `1px solid ${cssVar("rule")}`,
            paddingTop: 16,
            ...fade(msWindow(timing, 700, 500)),
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: cssVar("dim"),
            }}
          >
            {props.courseLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
};
