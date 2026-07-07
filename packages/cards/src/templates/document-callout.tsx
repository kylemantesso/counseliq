import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import type { CardComponentProps } from "../timing";
import { fade, fadeUp, msWindow } from "../interpolate";
import { fitDisplayFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";

/**
 * document-callout — a "paper" document panel with the excerpt highlighted
 * by an accent outline. Mockup choreography: title rises (100ms), paper
 * panel rises (350ms), highlighted excerpt row fades (900ms), source
 * footer fades (1400ms).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const DocumentCallout: FC<CardComponentProps<CardPropsFor<"document-callout">>> = ({ props, timing }) => {
  return (
    <div
      data-ciq-card="document-callout"
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
          ...display,
          fontSize: fitDisplayFontSize(props.title, 32),
          overflowWrap: "break-word",
          lineHeight: 1.1,
          ...fadeUp(msWindow(timing, 100, 500)),
        }}
      >
        {props.title}
      </div>
      {props.excerpt ? (
        <div
          style={{
            marginTop: 24,
            background: cssVar("paper"),
            color: cssVar("paperInk"),
            borderRadius: cssVar("radiusSm"),
            padding: "18px 16px",
            fontFamily: cssVar("fontMono"),
            boxShadow: cssVar("shadow"),
            ...fadeUp(msWindow(timing, 350, 500)),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              borderBottom: `1px solid ${cssVar("paperRule")}`,
              paddingBottom: 10,
            }}
          >
            <span style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase" }}>
              Document excerpt
            </span>
          </div>
          <div
            style={{
              marginTop: 12,
              padding: "8px 6px",
              fontSize: 12,
              lineHeight: 1.6,
              outline: `2px solid ${cssVar("accent")}`,
              borderRadius: 2,
              fontVariantNumeric: "tabular-nums",
              ...fade(msWindow(timing, 900, 400)),
            }}
          >
            {props.excerpt}
          </div>
        </div>
      ) : null}
      <div style={{ flex: 1 }} />
      {props.sourceLabel ? (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 7,
            ...fade(msWindow(timing, 1400, 600)),
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
              letterSpacing: ".12em",
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
