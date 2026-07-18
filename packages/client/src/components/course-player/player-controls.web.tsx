import { contentEndMsForTiming, type UnitTiming } from "@counseliq/course-schema";
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
  border: "1px solid #2d3540",
  borderRadius: 999,
  background: "#111820",
  color: "#a8b0bb",
  cursor: "pointer",
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 10.5,
  fontWeight: 700,
  padding: "7px 10px",
};

const iconButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  width: 44,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
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
    <div
      data-ciq-player-controls=""
      style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", color: "#8b95a2" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
        <button
          type="button"
          style={{
            width: 48,
            height: 48,
            flex: "0 0 48px",
            borderRadius: 999,
            border: "1px solid #f0efe9",
            background: "#f5f2ea",
            color: "#101419",
            cursor: "pointer",
            fontSize: 18,
            fontWeight: 800,
            boxShadow: "0 10px 28px rgba(0,0,0,.3)",
          }}
          onClick={onPlayPause}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "II" : "Play"}
        </button>
        <ScrubBar timing={timing} clock={clock} onSeek={onSeek} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 6 }}>
        {onPrevUnit ? (
          <button type="button" style={iconButtonStyle} onClick={onPrevUnit} aria-label="Previous unit">
            Prev
          </button>
        ) : null}
        <button type="button" style={iconButtonStyle} onClick={onSkipSentence} aria-label="Skip to next sentence">
          Skip
        </button>
        <button type="button" style={buttonStyle} onClick={onReplayUnit} aria-label="Replay unit">
          Replay
        </button>
        <button
          type="button"
          style={{ ...iconButtonStyle, opacity: muted ? 0.55 : 1 }}
          onClick={onToggleMute}
          aria-label={muted ? "Unmute narration" : "Mute narration"}
        >
          {muted ? "Off" : "On"}
        </button>
        {onNextUnit ? (
          <button type="button" style={iconButtonStyle} onClick={onNextUnit} aria-label="Next unit">
            Next
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
  const contentEndMs = contentEndMsForTiming(timing);
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ flex: "0 0 38px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "#7e8793", textAlign: "right" }}>
        {formatMs(clockMs)}
      </span>
      <input
        type="range"
        aria-label="Scrub unit timeline"
        min={0}
        max={contentEndMs}
        step={50}
        value={Math.min(contentEndMs, clockMs)}
        onChange={(e) => onSeek(Number(e.target.value))}
        style={{ flex: 1, minWidth: 0, accentColor: "#d6ad2f" }}
      />
      <span style={{ flex: "0 0 38px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "#7e8793" }}>
        {formatMs(contentEndMs)}
      </span>
    </div>
  );
}
