import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import { beatProgress, fadeUp, msWindow } from "../interpolate";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * list-reveal — numbered rows revealed one beat at a time (mockup 03).
 * The heading rises with the card entrance; each row's reveal is driven
 * by `beatProgress(timing, i)` so the host can anchor rows to narration.
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const ListReveal: FC<CardComponentProps<CardPropsFor<"list-reveal">>> = ({ props, timing }) => {
  const items = Array.isArray(props.items) ? props.items : [];
  // Density adapts to content: compiled items run longer than the mockup's
  // two-word examples, and 5+ rows must still clear the caption-safe zone.
  const longestText = items.reduce((max, item) => Math.max(max, item.text?.length ?? 0), 0);
  const dense = items.length >= 5 || longestText > 48;
  const itemFontSize = dense ? 16 : 19;
  const rowPadding = dense ? "12px 0" : "18px 0";
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
      {props.heading ? (
        <div
          style={{
            ...display,
            fontSize: 34,
            lineHeight: 1.12,
            ...fadeUp(msWindow(timing, 100, 500)),
          }}
        >
          {props.heading}
        </div>
      ) : null}
      <div style={{ marginTop: dense ? 22 : 34, display: "flex", flexDirection: "column" }}>
        {items.map((item, i) => (
          <div
            key={i}
            data-ciq-beat-item={i}
            style={{
              display: "flex",
              gap: 16,
              alignItems: "baseline",
              padding: rowPadding,
              borderTop: `1px solid ${cssVar("rule")}`,
              borderBottom: i === items.length - 1 ? `1px solid ${cssVar("rule")}` : undefined,
              ...fadeUp(beatProgress(timing, i)),
            }}
          >
            <span style={{ fontFamily: cssVar("fontMono"), fontSize: 12, color: cssVar("accent") }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ flex: "1 1 0", minWidth: 0, fontSize: itemFontSize, fontWeight: 600, lineHeight: 1.25 }}>
              {item.text}
            </span>
            {item.sourceLabel ? (
              <span
                data-ciq-source-label=""
                style={{
                  flex: "0 1 auto",
                  maxWidth: "34%",
                  fontFamily: cssVar("fontMono"),
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: cssVar("dim"),
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textAlign: "right",
                }}
                title={item.sourceLabel}
              >
                {item.sourceLabel}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};
