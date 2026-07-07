import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import { beatProgress, fadeUp, growY, msWindow } from "../interpolate";
import { fitDisplayFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * timeline-card — a vertical spine with dated events (mockup 07). The
 * spine grows across the card's WHOLE active window (`timing.progress`)
 * while events rise on their own beats; the last event is "today" and
 * takes the accent dot.
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const TimelineCard: FC<CardComponentProps<CardPropsFor<"timeline-card">>> = ({ props, timing }) => {
  const events = Array.isArray(props.events) ? props.events : [];
  const spineT = timing.reducedMotion ? 1 : timing.progress;
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
            fontSize: fitDisplayFontSize(props.heading, 32),
            overflowWrap: "break-word",
            lineHeight: 1.12,
            ...fadeUp(msWindow(timing, 100, 500)),
          }}
        >
          {props.heading}
        </div>
      ) : null}
      <div
        style={{
          position: "relative",
          marginTop: 36,
          paddingLeft: 26,
          display: "flex",
          flexDirection: "column",
          gap: 34,
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 5,
            top: 6,
            bottom: 6,
            width: 2,
            background: cssVar("rule"),
            ...growY(spineT),
          }}
        />
        {events.map((event, i) => {
          const last = i === events.length - 1;
          return (
            <div
              key={i}
              data-ciq-beat-item={i}
              style={{ position: "relative", ...fadeUp(beatProgress(timing, i)) }}
            >
              <span
                style={{
                  position: "absolute",
                  left: -26,
                  top: 4,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: last ? cssVar("accent") : cssVar("bg"),
                  border: `3px solid ${last ? cssVar("accent") : cssVar("dim")}`,
                }}
              />
              {event.date ? (
                <div
                  style={{
                    fontFamily: cssVar("fontMono"),
                    fontSize: 11,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: last ? cssVar("accent") : cssVar("dim"),
                  }}
                >
                  {event.date}
                </div>
              ) : null}
              <div style={{ fontSize: 19, fontWeight: 600, marginTop: 5 }}>{event.label}</div>
              {event.detail ? (
                <div style={{ fontSize: 14, color: cssVar("dim"), marginTop: 3 }}>{event.detail}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
