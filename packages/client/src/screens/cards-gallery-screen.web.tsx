"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrandThemeProvider,
  CardRenderer,
  CardStage,
  beatsRevealedAt,
  counseliqTheme,
  latrobeTheme,
  type CardTiming,
} from "@counseliq/cards";
import { CARD_PROP_FIXTURES, CARD_TEMPLATES } from "@counseliq/course-schema";

/**
 * Dev gallery: all 21 card templates rendered from their fixtures, driven by
 * one synthetic CardTiming. The scrub slider / replay loop own the clock —
 * cards stay pure functions of the timing prop (the rAF loop is allowed
 * HERE, never inside @counseliq/cards).
 */

const WINDOW_MS = 4000;

const THEMES = {
  counseliq: counseliqTheme,
  latrobe: latrobeTheme,
} as const;

type ThemeName = keyof typeof THEMES;

function timingAt(localMs: number, reducedMotion: boolean): CardTiming {
  return {
    localMs,
    progress: Math.min(1, Math.max(0, localMs / WINDOW_MS)),
    beatsRevealed: beatsRevealedAt(localMs),
    reducedMotion,
  };
}

export function CardsGalleryScreen() {
  const [themeName, setThemeName] = useState<ThemeName>("counseliq");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [showCaptionZone, setShowCaptionZone] = useState(false);
  const [localMs, setLocalMs] = useState(WINDOW_MS);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);

  const stopPlayback = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setPlaying(false);
  }, []);

  const replay = useCallback(() => {
    stopPlayback();
    setPlaying(true);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      if (elapsed >= WINDOW_MS) {
        setLocalMs(WINDOW_MS);
        rafRef.current = null;
        setPlaying(false);
        return;
      }
      setLocalMs(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopPlayback]);

  useEffect(() => stopPlayback, [stopPlayback]);

  const timing = timingAt(localMs, reducedMotion);
  const theme = THEMES[themeName];
  const templates = [...CARD_TEMPLATES].sort();

  return (
    <div
      data-ciq-cards-gallery=""
      style={{
        minHeight: "100vh",
        background: "#111418",
        color: "#e8e6e1",
        fontFamily: "'IBM Plex Mono', monospace",
        padding: 24,
      }}
    >
      <header style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginRight: "auto" }}>
          Card gallery — 21 templates
        </h1>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          theme
          <select
            value={themeName}
            onChange={(e) => setThemeName(e.target.value as ThemeName)}
            style={{ background: "#1c2128", color: "inherit", padding: "4px 8px", borderRadius: 6 }}
          >
            <option value="counseliq">counseliq</option>
            <option value="latrobe">latrobe</option>
          </select>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(e) => setReducedMotion(e.target.checked)}
          />
          reduced motion
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            checked={showCaptionZone}
            onChange={(e) => setShowCaptionZone(e.target.checked)}
          />
          caption-safe zone
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          scrub
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            disabled={playing}
            value={(localMs / WINDOW_MS) * 100}
            onChange={(e) => setLocalMs((Number(e.target.value) / 100) * WINDOW_MS)}
            style={{ width: 180 }}
          />
          <span style={{ width: 52, textAlign: "right" }}>{Math.round(localMs)}ms</span>
        </label>
        <button
          type="button"
          onClick={playing ? stopPlayback : replay}
          style={{
            background: "#2f6feb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {playing ? "stop" : "replay"}
        </button>
      </header>

      <BrandThemeProvider theme={theme}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 20,
          }}
        >
          {templates.map((template) => (
            <figure key={template} style={{ margin: 0 }}>
              <div style={{ width: "100%", aspectRatio: "360 / 640" }}>
                <CardStage showCaptionSafeZone={showCaptionZone}>
                  <CardRenderer
                    template={template}
                    props={CARD_PROP_FIXTURES[template]}
                    timing={timing}
                  />
                </CardStage>
              </div>
              <figcaption style={{ fontSize: 11, opacity: 0.7, marginTop: 6, textAlign: "center" }}>
                {template}
              </figcaption>
            </figure>
          ))}
        </div>
      </BrandThemeProvider>
    </div>
  );
}
