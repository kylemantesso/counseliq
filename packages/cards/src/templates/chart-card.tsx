import type { CardPropsFor } from "@counseliq/course-schema";
import { beatProgress, fade, fadeUp, growX, msWindow } from "../interpolate";
import { fitDisplayFontSize } from "../fit";
import { visibleSourceLabels } from "../source-labels";
import { cssVar } from "../theme/brand-theme-provider";
import type { CardComponentProps } from "../timing";

/**
 * 19 · chart-card — horizontal bars growing in one per beat, widths
 * proportional to the series values. Values may arrive as strings
 * ("A$29,710", "81%"): the first number in the string (commas stripped)
 * sizes the bar and the original string renders verbatim as the label, so
 * currency and unit formatting survive untouched. Non-numeric values fall
 * back to a minimal bar. The mockup emphasises the final series entry with
 * the accent colour; sourceLabel renders as the compliance footer.
 */

function numericValue(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

export function ChartCard({ props, timing }: CardComponentProps<CardPropsFor<"chart-card">>) {
  const [sourceLabel] = visibleSourceLabels(props.sourceLabel as string | undefined);
  const values = props.series.map((entry) => numericValue(entry.value));
  const max = Math.max(...values.map((v) => (v === null ? 0 : Math.abs(v))), 1);

  return (
    <div
      data-ciq-card="chart-card"
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
      {props.heading ? (
        <div
          style={{
            fontFamily: cssVar("fontDisplay"),
            fontWeight: cssVar("displayWeight") as never,
            textTransform: cssVar("titleCase") as never,
            letterSpacing: cssVar("tracking"),
            fontSize: fitDisplayFontSize(props.heading, 34),
            overflowWrap: "break-word",
            lineHeight: 1.1,
            ...fadeUp(msWindow(timing, 200, 500)),
          }}
        >
          {props.heading}
        </div>
      ) : null}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 26,
          borderLeft: `1px solid ${cssVar("rule")}`,
          paddingLeft: 2,
        }}
      >
        {props.series.map((entry, i) => {
          const emphasised = i === props.series.length - 1;
          const value = values[i];
          const widthPct = value === null ? 6 : Math.max(6, (Math.abs(value) / max) * 100);
          const t = beatProgress(timing, i);
          return (
            <div key={`${entry.label}-${i}`} data-ciq-chart-bar="">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 9,
                  color: emphasised ? cssVar("accent") : undefined,
                  ...fade(t),
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600 }}>{entry.label}</span>
                <span
                  style={{
                    fontFamily: cssVar("fontMono"),
                    fontSize: 13,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {String(entry.value)}
                </span>
              </div>
              <div
                style={{
                  height: 22,
                  width: `${widthPct}%`,
                  background: emphasised ? cssVar("accent") : cssVar("ink"),
                  opacity: emphasised ? undefined : 0.32,
                  ...growX(t),
                }}
              />
            </div>
          );
        })}
      </div>
      {sourceLabel ? (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 7,
            ...fade(beatProgress(timing, props.series.length)),
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
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: cssVar("dim"),
            }}
          >
            {sourceLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}
