import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import { beatProgress, fadeUp, msWindow } from "../interpolate";
import { fitDisplayFontSize } from "../fit";
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
  // Per-item source labels are NOT rendered inline — repeated/truncated
  // citations read as noise in the rows. Attribution consolidates into one
  // deduped footer line (stat-card's quiet style).
  const sourceLabels = [
    ...new Set(
      items
        .map((item) => (typeof item.sourceLabel === "string" ? item.sourceLabel.trim() : ""))
        .filter((label) => label.length > 0)
    ),
  ];
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
            fontSize: fitDisplayFontSize(props.heading, 34),
            lineHeight: 1.12,
            overflowWrap: "break-word",
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
          </div>
        ))}
      </div>
      {sourceLabels.length > 0 ? (
        <div
          data-ciq-source-label=""
          style={{
            marginTop: "auto",
            paddingTop: 14,
            display: "flex",
            alignItems: "flex-start",
            gap: 7,
            ...fadeUp(beatProgress(timing, items.length)),
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
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: cssVar("dim"),
              lineHeight: 1.5,
            }}
          >
            {sourceLabels.join(" · ")}
          </span>
        </div>
      ) : null}
    </div>
  );
};
