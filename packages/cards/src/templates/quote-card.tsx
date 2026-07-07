import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import type { CardComponentProps } from "../timing";
import { fade, fadeUp, msWindow } from "../interpolate";
import { fitBlockFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";

/**
 * quote-card — big serif pull quote. Mockup choreography: quote mark fades
 * (100ms), quote rises (300ms), attribution block fades over a top rule
 * (850ms).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const QuoteCard: FC<CardComponentProps<CardPropsFor<"quote-card">>> = ({ props, timing }) => {
  return (
    <div
      data-ciq-card="quote-card"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        padding: "36px 30px 108px",
        overflow: "hidden",
        background: cssVar("bg"),
        color: cssVar("ink"),
        fontFamily: cssVar("fontText"),
      }}
    >
      <div
        aria-hidden
        style={{
          fontFamily: cssVar("fontDisplay"),
          fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
          fontSize: 88,
          lineHeight: 0.6,
          color: cssVar("accent"),
          paddingTop: 26,
          ...fade(msWindow(timing, 100, 500)),
        }}
      >
        &ldquo;
      </div>
      <div
        style={{
          marginTop: 26,
          ...display,
          // 496px column minus quote mark and attribution footer.
          fontSize: fitBlockFontSize(props.quote, 31, {
            maxHeightPx: 300,
            lineHeight: 1.28,
          }),
          overflowWrap: "break-word",
          lineHeight: 1.28,
          ...fadeUp(msWindow(timing, 300, 550)),
        }}
      >
        {props.quote}
      </div>
      <div style={{ flex: 1 }} />
      {props.attribution || props.sourceLabel ? (
        <div
          style={{
            borderTop: `1px solid ${cssVar("rule")}`,
            paddingTop: 16,
            ...fade(msWindow(timing, 850, 500)),
          }}
        >
          {props.attribution ? (
            <div style={{ fontSize: 16, fontWeight: 600 }}>{props.attribution}</div>
          ) : null}
          {props.sourceLabel ? (
            <div style={{ fontSize: 14, color: cssVar("dim"), marginTop: 3 }}>{props.sourceLabel}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
