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
            fontSize: 34,
            lineHeight: 1.12,
            ...fadeUp(msWindow(timing, 100, 500)),
          }}
        >
          {props.heading}
        </div>
      ) : null}
      <div style={{ marginTop: 34, display: "flex", flexDirection: "column" }}>
        {items.map((item, i) => (
          <div
            key={i}
            data-ciq-beat-item={i}
            style={{
              display: "flex",
              gap: 16,
              alignItems: "baseline",
              padding: "18px 0",
              borderTop: `1px solid ${cssVar("rule")}`,
              borderBottom: i === items.length - 1 ? `1px solid ${cssVar("rule")}` : undefined,
              ...fadeUp(beatProgress(timing, i)),
            }}
          >
            <span style={{ fontFamily: cssVar("fontMono"), fontSize: 12, color: cssVar("accent") }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ flex: 1, fontSize: 19, fontWeight: 600 }}>{item.text}</span>
            {item.sourceLabel ? (
              <span
                data-ciq-source-label=""
                style={{
                  fontFamily: cssVar("fontMono"),
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: cssVar("dim"),
                  whiteSpace: "nowrap",
                }}
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
