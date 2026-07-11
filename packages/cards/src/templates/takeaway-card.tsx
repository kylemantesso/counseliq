import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import type { CardComponentProps } from "../timing";
import { fade, fadeUp, msWindow } from "../interpolate";
import { fitBlockFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";
import { BackgroundMediaLayer } from "../background-media";

/**
 * takeaway-card — the unit's settled anchor statement. Mockup choreography:
 * badge row fades (100ms), takeaway text rises centered (300ms), "saved"
 * chip rises (1000ms).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

export const TakeawayCard: FC<CardComponentProps<CardPropsFor<"takeaway-card">>> = ({ props, timing }) => {
  return (
    <div
      data-ciq-card="takeaway-card"
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
      <BackgroundMediaLayer
        assetRef={props.bgAssetRef}
        treatment={props.bgTreatment}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: 10,
          ...fade(msWindow(timing, 100, 500)),
        }}
      >
        <span style={{ width: 22, height: 3, background: cssVar("accent") }} />
        <span
          style={{
            fontFamily: cssVar("fontMono"),
            fontSize: 12,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: cssVar("accent"),
          }}
        >
          Takeaway
        </span>
      </div>
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            ...display,
            // Height budget: 496px column minus badge row and "saved" chip.
            fontSize: fitBlockFontSize(props.text, 33, { maxHeightPx: 400 }),
            overflowWrap: "break-word",
            lineHeight: 1.3,
            ...fadeUp(msWindow(timing, 300, 600)),
          }}
        >
          {props.text}
        </div>
      </div>
      <div
        style={{
          position: "relative",
          zIndex: 1,
          alignSelf: "flex-start",
          display: "flex",
          alignItems: "center",
          gap: 9,
          border: `1px solid ${cssVar("rule")}`,
          borderRadius: 999,
          padding: "10px 18px",
          ...fadeUp(msWindow(timing, 1000, 500)),
        }}
      >
        <span style={{ color: cssVar("accent"), fontSize: 14, lineHeight: 1 }}>✓</span>
        <span
          style={{
            fontFamily: cssVar("fontMono"),
            fontSize: 11,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: cssVar("dim"),
          }}
        >
          Saved to crib deck
        </span>
      </div>
    </div>
  );
};
