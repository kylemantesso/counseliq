import type { CSSProperties, FC } from "react";
import type { CardPropsFor } from "@counseliq/course-schema";
import type { CardComponentProps } from "../timing";
import { fade, fadeUp, growX, msWindow } from "../interpolate";
import { fitBlockFontSize } from "../fit";
import { cssVar } from "../theme/brand-theme-provider";

/**
 * title-card — module/section opener. Mockup choreography: kicker fades in
 * (100ms), accent bar grows (300ms), title rises (350ms), footer fades
 * (700ms).
 */

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readCounter(props: CardPropsFor<"title-card">): string | null {
  const record = props as Record<string, unknown>;
  for (const key of ["positionLabel", "indexLabel", "counterLabel", "progressLabel"]) {
    const value = readText(record[key]);
    if (value) return value;
  }
  return null;
}

function readLogoUrl(props: CardPropsFor<"title-card">): string | null {
  const record = props as Record<string, unknown>;
  const value = readText(record.logoUrl);
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export const TitleCard: FC<CardComponentProps<CardPropsFor<"title-card">>> = ({ props, timing }) => {
  const title = readText(props.title);
  const kicker = readText(props.kicker);
  const courseLabel = readText(props.courseLabel);
  const heading = title ?? kicker ?? "";
  const kickerLabel = title ? kicker : null;
  const counterLabel = readCounter(props);
  const logoUrl = readLogoUrl(props);
  const showFooter = Boolean(courseLabel || counterLabel);
  const headingSize = fitBlockFontSize(heading, 47, {
    maxHeightPx: 320,
    lineHeight: 1.08,
    minPx: 25,
  });

  return (
    <div
      data-ciq-card="title-card"
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
      {kickerLabel ? (
        <div
          style={{
            fontFamily: cssVar("fontMono"),
            fontSize: 12,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: cssVar("accent"),
            ...fade(msWindow(timing, 100, 500)),
          }}
        >
          {kickerLabel}
        </div>
      ) : null}
      {kickerLabel ? (
        <div
          style={{
            width: 44,
            height: 3,
            background: cssVar("accent"),
            margin: "22px 0 26px",
            ...growX(msWindow(timing, 300, 500)),
          }}
        />
      ) : null}
      <div
        style={{
          ...display,
          fontSize: headingSize,
          lineHeight: 1.08,
          overflowWrap: "break-word",
          maxWidth: 300,
          marginTop: kickerLabel ? 0 : 6,
          ...fadeUp(msWindow(timing, 350, 500)),
        }}
      >
        {heading}
      </div>
      <div style={{ flex: 1 }} />
      {showFooter ? (
        <div
          style={{
            borderTop: `1px solid ${cssVar("rule")}`,
            paddingTop: 16,
            display: "flex",
            justifyContent: courseLabel && counterLabel ? "space-between" : "flex-start",
            alignItems: "center",
            gap: 12,
            paddingRight: logoUrl ? 168 : 0,
            ...fade(msWindow(timing, 700, 500)),
          }}
        >
          {courseLabel ? (
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: cssVar("dim"),
                minWidth: 0,
              }}
            >
              {courseLabel}
            </span>
          ) : null}
          {counterLabel ? (
            <span
              style={{
                fontFamily: cssVar("fontMono"),
                fontSize: 11,
                color: cssVar("dim"),
                whiteSpace: "nowrap",
              }}
            >
              {counterLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      {logoUrl ? (
        <img
          data-ciq-title-logo=""
          src={logoUrl}
          alt=""
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 30,
            bottom: 104,
            maxHeight: 56,
            maxWidth: 152,
            width: "auto",
            height: "auto",
            objectFit: "contain",
            display: "block",
            ...fade(msWindow(timing, 700, 500)),
          }}
        />
      ) : null}
    </div>
  );
};
