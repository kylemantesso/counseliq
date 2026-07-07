import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import type { CardComponentProps } from "../timing";
import { fade, fadeUp, growX, interpolate, msWindow } from "../interpolate";
import { fitDisplayFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";

/**
 * myth-fact-card — two-beat correction. Mockup choreography: myth label
 * fades (100ms), myth text rises (250ms); at 1000ms the myth is struck
 * through (growX) and the whole myth block dims to 0.35 (kDim); the FACT
 * badge fades (1350ms) and the fact text rises (1500ms).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const MythFactCard: FC<CardComponentProps<CardPropsFor<"myth-fact-card">>> = ({ props, timing }) => {
  // kDim — the myth block settles at 0.35 opacity once the fact arrives.
  const dim = interpolate(msWindow(timing, 1000, 500), [0, 1], [1, 0.35]);
  return (
    <div
      data-ciq-card="myth-fact-card"
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
      <div style={{ opacity: dim }}>
        <div style={{ position: "relative", display: "inline-block", ...fade(msWindow(timing, 100, 400)) }}>
          <span
            style={{
              fontFamily: cssVar("fontMono"),
              fontSize: 12,
              letterSpacing: ".24em",
              textTransform: "uppercase",
              color: cssVar("dim"),
            }}
          >
            Myth
          </span>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: -4,
              right: -4,
              top: "50%",
              height: 2,
              background: cssVar("accent"),
              ...growX(msWindow(timing, 1000, 350)),
            }}
          />
        </div>
        <div
          style={{
            ...display,
            fontSize: fitDisplayFontSize(props.myth, 29),
            overflowWrap: "break-word",
            lineHeight: 1.25,
            marginTop: 14,
            ...fadeUp(msWindow(timing, 250, 500)),
          }}
        >
          &ldquo;{props.myth}&rdquo;
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div>
        <div
          style={{
            display: "inline-block",
            background: cssVar("accent"),
            color: cssVar("accentInk"),
            fontFamily: cssVar("fontMono"),
            fontSize: 12,
            letterSpacing: ".24em",
            textTransform: "uppercase",
            padding: "6px 12px",
            borderRadius: cssVar("radiusSm"),
            ...fade(msWindow(timing, 1350, 400)),
          }}
        >
          Fact
        </div>
        <div
          style={{
            ...display,
            fontSize: fitDisplayFontSize(props.fact, 29),
            overflowWrap: "break-word",
            lineHeight: 1.25,
            marginTop: 16,
            ...fadeUp(msWindow(timing, 1500, 550)),
          }}
        >
          {props.fact}
        </div>
      </div>
      <div style={{ height: 36 }} />
    </div>
  );
};
