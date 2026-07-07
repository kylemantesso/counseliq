import type { UnitTiming } from "@counseliq/course-schema";
import type { UnitClockStore } from "./clock-store.web";
import { useUnitClock } from "./clock-store.web";
import { formatMs } from "./timeline-helpers";

/**
 * Transport controls under the stage — studio chrome, not card content, so
 * it uses fixed studio styling rather than brand tokens. The scrub bar maps
 * the full unit clock; skip jumps a sentence.
 */

export interface PlayerControlsProps {
  timing: UnitTiming;
  clock: UnitClockStore;
  playing: boolean;
  muted: boolean;
  onPlayPause: () => void;
  onSkipSentence: () => void;
  onReplayUnit: () => void;
  onToggleMute: () => void;
  onSeek: (ms: number) => void;
  onPrevUnit?: () => void;
  onNextUnit?: () => void;
}

const buttonStyle: React.CSSProperties = {
  border: "1px solid #3a4048",
  borderRadius: 999,
  background: "transparent",
  color: "#e8e6e1",
  cursor: "pointer",
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11.5,
  letterSpacing: ".05em",
  padding: "9px 16px",
};

export function PlayerControls({
  timing,
  clock,
  playing,
  muted,
  onPlayPause,
  onSkipSentence,
  onReplayUnit,
  onToggleMute,
  onSeek,
  onPrevUnit,
  onNextUnit,
}: PlayerControlsProps) {
  return (
    <div data-ciq-player-controls="" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <ScrubBar timing={timing} clock={clock} onSeek={onSeek} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {onPrevUnit ? (
          <button type="button" style={buttonStyle} onClick={onPrevUnit} aria-label="Previous unit">
            ‹ Unit
          </button>
        ) : null}
        <button
          type="button"
          style={{ ...buttonStyle, minWidth: 92, borderColor: "#2f6feb" }}
          onClick={onPlayPause}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <button type="button" style={buttonStyle} onClick={onSkipSentence} aria-label="Skip to next sentence">
          Skip ›
        </button>
        <button type="button" style={buttonStyle} onClick={onReplayUnit} aria-label="Replay unit">
          ⟲ Unit
        </button>
        <button
          type="button"
          style={{ ...buttonStyle, opacity: muted ? 0.55 : 1 }}
          onClick={onToggleMute}
          aria-label={muted ? "Unmute narration" : "Mute narration"}
        >
          {muted ? "Sound off" : "Sound on"}
        </button>
        {onNextUnit ? (
          <button type="button" style={buttonStyle} onClick={onNextUnit} aria-label="Next unit">
            Unit ›
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ScrubBar({
  timing,
  clock,
  onSeek,
}: {
  timing: UnitTiming;
  clock: UnitClockStore;
  onSeek: (ms: number) => void;
}) {
  const clockMs = useUnitClock(clock);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "#9aa3ad", width: 38, textAlign: "right" }}>
        {formatMs(clockMs)}
      </span>
      <input
        type="range"
        aria-label="Scrub unit timeline"
        min={0}
        max={timing.totalDurationMs}
        step={50}
        value={Math.min(timing.totalDurationMs, clockMs)}
        onChange={(e) => onSeek(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "#9aa3ad", width: 38 }}>
        {formatMs(timing.totalDurationMs)}
      </span>
    </div>
  );
}
