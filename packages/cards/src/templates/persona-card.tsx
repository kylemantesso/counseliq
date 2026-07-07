import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import { beatProgress, fade, fadeUp, msWindow } from "../interpolate";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * persona-card — a case-file style introduction (mockup 12): header
 * rule, avatar + name block, detail chips, and a closing prompt. The
 * chips are the card's beats (`beatProgress(timing, i)`); the avatar
 * block and footer use entrance windows around them.
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const PersonaCard: FC<CardComponentProps<CardPropsFor<"persona-card">>> = ({ props, timing }) => {
  const chips = Array.isArray(props.chips) ? props.chips : [];
  const initial = (props.name ?? "?").trim().charAt(0).toUpperCase() || "?";
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          borderBottom: `1px solid ${cssVar("rule")}`,
          paddingBottom: 14,
          ...fade(msWindow(timing, 100, 500)),
        }}
      >
        <span
          style={{
            fontFamily: cssVar("fontMono"),
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: cssVar("dim"),
          }}
        >
          Case file
        </span>
        <span style={{ fontFamily: cssVar("fontMono"), fontSize: 11, color: cssVar("accent") }}>SCENARIO</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          marginTop: 28,
          ...fadeUp(msWindow(timing, 300, 500)),
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: cssVar("chip"),
            border: `1px solid ${cssVar("rule")}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: cssVar("fontDisplay"),
            fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
            fontSize: 30,
            color: cssVar("accent"),
            flex: "0 0 auto",
          }}
        >
          {initial}
        </div>
        <div>
          <div style={{ ...display, fontSize: 32, lineHeight: 1.05 }}>{props.name}</div>
          {props.location ? (
            <div style={{ fontSize: 15, color: cssVar("dim"), marginTop: 5 }}>{props.location}</div>
          ) : null}
        </div>
      </div>
      {chips.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 28 }}>
          {chips.map((chip, i) => {
            const last = i === chips.length - 1;
            return (
              <span
                key={i}
                data-ciq-beat-item={i}
                style={{
                  fontFamily: cssVar("fontMono"),
                  fontSize: 11.5,
                  border: `1px solid ${last ? cssVar("accent") : cssVar("rule")}`,
                  borderRadius: cssVar("radiusSm"),
                  padding: "8px 12px",
                  color: last ? cssVar("accent") : cssVar("dim"),
                  ...fadeUp(beatProgress(timing, i)),
                }}
              >
                {chip}
              </span>
            );
          })}
        </div>
      ) : null}
      <div style={{ flex: 1 }} />
      {props.footerPrompt ? (
        <div
          style={{
            borderTop: `1px solid ${cssVar("rule")}`,
            paddingTop: 18,
            ...fadeUp(beatProgress(timing, chips.length)),
          }}
        >
          <div style={{ ...display, fontSize: 25, lineHeight: 1.2 }}>{props.footerPrompt}</div>
        </div>
      ) : null}
    </div>
  );
};
