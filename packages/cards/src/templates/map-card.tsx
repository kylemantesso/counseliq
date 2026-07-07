import type { CardPropsFor } from "@counseliq/course-schema";
import { beatProgress, fade, fadeUp, msWindow, pop } from "../interpolate";
import { fitDisplayFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * 06 · map-card — stylised region blob with marker pins popping in one per
 * beat. Marker positions come from a fixed layout table (deterministic by
 * index — real geography is out of scope for a review surface); markers named
 * in `highlight` (and the last marker, the mockup's "hub") render emphasised.
 */

const MARKER_POSITIONS: readonly { left: string; top: string }[] = [
  { left: "10%", top: "14%" },
  { left: "48%", top: "26%" },
  { left: "60%", top: "42%" },
  { left: "30%", top: "55%" },
  { left: "42%", top: "76%" },
  { left: "14%", top: "38%" },
  { left: "66%", top: "62%" },
  { left: "22%", top: "70%" },
];

export function MapCard({ props, timing }: CardComponentProps<CardPropsFor<"map-card">>) {
  const markers = props.markers.slice(0, MARKER_POSITIONS.length);
  const highlighted = new Set(props.highlight ?? []);

  return (
    <div
      data-ciq-card="map-card"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        padding: "36px 30px 108px",
        background: cssVar("bg"),
        color: cssVar("ink"),
        fontFamily: cssVar("fontText"),
      }}
    >
      {props.region ? (
        <div
          style={{
            fontFamily: cssVar("fontDisplay"),
            fontWeight: cssVar("displayWeight") as never,
            textTransform: cssVar("titleCase") as never,
            letterSpacing: cssVar("tracking"),
            fontSize: fitDisplayFontSize(props.region, 36),
            overflowWrap: "break-word",
            lineHeight: 1.1,
            ...fadeUp(msWindow(timing, 200, 500)),
          }}
        >
          {props.region}
        </div>
      ) : null}
      <div style={{ position: "relative", flex: 1, marginTop: 18 }}>
        <div
          style={{
            position: "absolute",
            inset: "4% 2% 6% 2%",
            background: cssVar("chip"),
            border: `1px solid ${cssVar("rule")}`,
            borderRadius: "58% 42% 55% 45% / 42% 52% 48% 58%",
            ...fade(msWindow(timing, 300, 700)),
          }}
        />
        {markers.map((marker, i) => {
          const isHub = i === markers.length - 1;
          const emphasised = isHub || highlighted.has(marker);
          const t = beatProgress(timing, i);
          return (
            <div
              key={marker}
              data-ciq-map-marker=""
              style={{
                position: "absolute",
                left: MARKER_POSITIONS[i].left,
                top: MARKER_POSITIONS[i].top,
                display: "flex",
                alignItems: "center",
                gap: 7,
                ...pop(t),
              }}
            >
              <span
                style={{
                  width: emphasised ? 14 : 9,
                  height: emphasised ? 14 : 9,
                  borderRadius: "50%",
                  background: cssVar("accent"),
                  boxShadow: emphasised ? `0 0 0 4px ${cssVar("chip")}` : undefined,
                }}
              />
              <span
                style={
                  emphasised
                    ? { fontSize: 14, fontWeight: 600 }
                    : { fontFamily: cssVar("fontMono"), fontSize: 11 }
                }
              >
                {marker}
              </span>
            </div>
          );
        })}
      </div>
      {props.caption ? (
        <div style={{ fontSize: 15, color: cssVar("dim"), ...fade(beatProgress(timing, markers.length)) }}>
          {props.caption}
        </div>
      ) : null}
    </div>
  );
}
