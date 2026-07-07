import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import { beatProgress, fade, fadeUp, msWindow } from "../interpolate";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * comparison-split — two labelled groups separated by a "vs" rule
 * (mockup 04, generalised to item lists). Beats run through the left
 * items then the right items, so `beatProgress` reveals the comparison
 * in narration order; the right group carries the accent.
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

function GroupHeading({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: cssVar("dim"),
        marginBottom: 8,
      }}
    >
      {text}
    </div>
  );
}

export const ComparisonSplit: FC<CardComponentProps<CardPropsFor<"comparison-split">>> = ({ props, timing }) => {
  const leftItems = Array.isArray(props.leftItems) ? props.leftItems : [];
  const rightItems = Array.isArray(props.rightItems) ? props.rightItems : [];
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ padding: "20px 0" }}>
          {props.leftHeading ? <GroupHeading text={props.leftHeading} /> : null}
          {leftItems.map((item, i) => (
            <div
              key={i}
              data-ciq-beat-item={i}
              style={{
                ...display,
                fontSize: 26,
                lineHeight: 1.35,
                ...fadeUp(beatProgress(timing, i)),
              }}
            >
              {item}
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            ...fade(msWindow(timing, 300, 400)),
          }}
        >
          <span style={{ flex: 1, height: 1, background: cssVar("rule") }} />
          <span
            style={{
              fontFamily: cssVar("fontMono"),
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: cssVar("dim"),
            }}
          >
            vs
          </span>
          <span style={{ flex: 1, height: 1, background: cssVar("rule") }} />
        </div>
        <div style={{ padding: "20px 0" }}>
          {props.rightHeading ? <GroupHeading text={props.rightHeading} /> : null}
          {rightItems.map((item, i) => (
            <div
              key={i}
              data-ciq-beat-item={leftItems.length + i}
              style={{
                ...display,
                fontSize: 26,
                lineHeight: 1.35,
                color: cssVar("accent"),
                ...fadeUp(beatProgress(timing, leftItems.length + i)),
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
