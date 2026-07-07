import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import type { CardComponentProps } from "../timing";
import { fade, fadeUp, msWindow, pop } from "../interpolate";
import { fitDisplayFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";

/**
 * alert-card — compliance warning with a full accent border frame. Mockup
 * choreography: border fades immediately (0ms), warning icon pops (250ms),
 * kicker fades (450ms), message rises centered (600ms).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const AlertCard: FC<CardComponentProps<CardPropsFor<"alert-card">>> = ({ props, timing }) => {
  return (
    <div
      data-ciq-card="alert-card"
      style={{
        position: "absolute",
        inset: 0,
        background: cssVar("bg"),
        color: cssVar("ink"),
        fontFamily: cssVar("fontText"),
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          border: `7px solid ${cssVar("accent")}`,
          pointerEvents: "none",
          zIndex: 4,
          ...fade(msWindow(timing, 0, 400)),
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          padding: "44px 36px 112px",
        }}
      >
        <div style={{ ...pop(msWindow(timing, 250, 450)) }}>
          <svg width="46" height="42" viewBox="0 0 24 22" aria-hidden="true">
            <path
              d="M12 2 22.5 20.5 H1.5 Z"
              fill="none"
              stroke={cssVar("accent")}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <line x1="12" y1="9" x2="12" y2="14" stroke={cssVar("accent")} strokeWidth="2" />
            <circle cx="12" cy="17" r="1.3" fill={cssVar("accent")} />
          </svg>
        </div>
        <div
          style={{
            fontFamily: cssVar("fontMono"),
            fontSize: 12,
            letterSpacing: ".24em",
            textTransform: "uppercase",
            color: cssVar("accent"),
            marginTop: 22,
            ...fade(msWindow(timing, 450, 400)),
          }}
        >
          Alert
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div
            style={{
              ...display,
              fontSize: fitDisplayFontSize(props.message, 31),
              overflowWrap: "break-word",
              lineHeight: 1.28,
              ...fadeUp(msWindow(timing, 600, 500)),
            }}
          >
            {props.message}
          </div>
        </div>
      </div>
    </div>
  );
};
