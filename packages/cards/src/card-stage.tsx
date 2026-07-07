import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cssVar } from "./theme/brand-theme-provider";

/**
 * The 9:16 design canvas. Cards are authored at exactly 360×640 (the mockup
 * frame); CardStage measures its container and scales the canvas to fit.
 *
 * This is the ONE file in the package allowed useLayoutEffect/useRef — it
 * measures layout, it does not animate. The no-timers test whitelists it
 * for hooks only.
 */

export const STAGE_WIDTH = 360;
export const STAGE_HEIGHT = 640;
/** Bottom band reserved for captions — cards keep critical content above it. */
export const CAPTION_SAFE_HEIGHT = 96;

export interface CardStageProps {
  children: ReactNode;
  /** Render a guide overlay for the caption-safe zone (dev gallery). */
  showCaptionSafeZone?: boolean;
  style?: CSSProperties;
}

export function CardStage({ children, showCaptionSafeZone = false, style }: CardStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setScale(Math.min(rect.width / STAGE_WIDTH, rect.height / STAGE_HEIGHT));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      data-ciq-stage=""
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          position: "relative",
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          flex: "none",
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          borderRadius: cssVar("radius"),
          boxShadow: cssVar("shadow"),
          overflow: "hidden",
          background: cssVar("bg"),
        }}
      >
        {children}
        {showCaptionSafeZone ? (
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: CAPTION_SAFE_HEIGHT,
              borderTop: `1px dashed ${cssVar("rule")}`,
              background: "repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(127,127,127,.08) 6px, rgba(127,127,127,.08) 12px)",
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
