import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import { beatProgress, fadeUp, growX, msWindow } from "../interpolate";
import { fitDisplayFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * breakdown-card — labelled amounts plus a proportional meter (mockup 14).
 * Each part's row rises and its meter segment grows on the same beat
 * (`beatProgress(timing, i)`). Segment widths come from numeric values
 * parsed out of the (possibly string) `value`s; when nothing parses the
 * meter falls back to equal segments.
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

/** "A$29,710" → 29710; 650 → 650; unparseable → null. */
function numericValue(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const digits = value.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? n : null;
}

export const BreakdownCard: FC<CardComponentProps<CardPropsFor<"breakdown-card">>> = ({ props, timing }) => {
  const parts = Array.isArray(props.parts) ? props.parts : [];
  const numbers = parts.map((p) => numericValue(p.value));
  const total = numbers.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const widths = parts.map((_, i) => {
    if (total <= 0 || numbers[i] === null) return 100 / Math.max(1, parts.length);
    return ((numbers[i] as number) / total) * 100;
  });
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
      {props.heading ? (
        <div
          style={{
            ...display,
            fontSize: fitDisplayFontSize(props.heading, 31),
            overflowWrap: "break-word",
            lineHeight: 1.14,
            ...fadeUp(msWindow(timing, 100, 500)),
          }}
        >
          {props.heading}
        </div>
      ) : null}
      <div
        style={{
          marginTop: 30,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {parts.map((part, i) => (
          <div
            key={i}
            data-ciq-beat-item={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              ...fadeUp(beatProgress(timing, i)),
            }}
          >
            <span style={{ fontSize: 16 }}>{part.label}</span>
            <span style={{ fontFamily: cssVar("fontMono"), fontSize: 14 }}>{part.value}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", height: 16, marginTop: 24, borderRadius: 3, overflow: "hidden", gap: 2 }}>
        {parts.map((_, i) => (
          <div key={i} style={{ width: `${widths[i]}%` }}>
            <div
              style={{
                height: "100%",
                background: cssVar("accent"),
                opacity: 0.45 + (0.55 * (i + 1)) / Math.max(1, parts.length),
                ...growX(beatProgress(timing, i)),
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
