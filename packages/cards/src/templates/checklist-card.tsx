import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import { beatProgress, fadeUp, msWindow, pop } from "../interpolate";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * checklist-card — ticked items landing one beat at a time (mockup 21).
 * Each row rises via `beatProgress(timing, i)`; its tick pops slightly
 * behind the row (same beat, back half of the entrance).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const ChecklistCard: FC<CardComponentProps<CardPropsFor<"checklist-card">>> = ({ props, timing }) => {
  const items = Array.isArray(props.items) ? props.items : [];
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
            fontSize: 33,
            lineHeight: 1.12,
            ...fadeUp(msWindow(timing, 100, 500)),
          }}
        >
          {props.heading}
        </div>
      ) : null}
      <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 22 }}>
        {items.map((item, i) => {
          const t = beatProgress(timing, i);
          // The tick pops in the back half of the row's entrance.
          const tick = Math.min(1, Math.max(0, (t - 0.5) * 2));
          return (
            <div
              key={i}
              data-ciq-beat-item={i}
              style={{ display: "flex", alignItems: "center", gap: 16, ...fadeUp(t) }}
            >
              <span
                style={{
                  flex: "0 0 auto",
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  border: `2px solid ${cssVar("accent")}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ color: cssVar("accent"), fontSize: 14, lineHeight: 1, ...pop(tick) }}>✓</span>
              </span>
              <span style={{ fontSize: 18, fontWeight: 600 }}>{item}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
