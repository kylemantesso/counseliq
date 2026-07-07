import type { UnitTiming } from "@counseliq/course-schema";
import { CAPTION_SAFE_HEIGHT, cssVar, deriveActiveSentence } from "@counseliq/cards";
import type { UnitClockStore } from "./clock-store.web";
import { useUnitClock } from "./clock-store.web";

/**
 * Captions in the 96px caption-safe zone: the active sentence's speakText
 * tokens (they ARE the spoken words), with the currently-spoken word
 * emphasised. Subscribes to the clock store directly so 60fps updates stay
 * in this leaf.
 */

export interface CaptionBarProps {
  timing: UnitTiming;
  clock: UnitClockStore;
  playing: boolean;
  /** E5 wires this: pencil-edit for the visible sentence while paused. */
  onEditSentence?: (narrationId: string) => void;
}

export function CaptionBar({ timing, clock, playing, onEditSentence }: CaptionBarProps) {
  const clockMs = useUnitClock(clock);
  const { sentenceIndex, wordIndex } = deriveActiveSentence(timing, clockMs);
  // In gaps, keep showing the last finished sentence rather than flashing empty.
  let shownIndex = sentenceIndex;
  if (shownIndex === null) {
    for (let i = timing.sentences.length - 1; i >= 0; i--) {
      if (timing.sentences[i].startMs <= clockMs) {
        shownIndex = i;
        break;
      }
    }
  }
  if (shownIndex === null) return <CaptionFrame />;
  const sentence = timing.sentences[shownIndex];
  const activeWord = sentenceIndex === null ? sentence.words.length - 1 : wordIndex;

  return (
    <CaptionFrame>
      <div
        style={{
          background: cssVar("scrim"),
          color: cssVar("photoInk"),
          fontSize: 14.5,
          lineHeight: 1.4,
          textAlign: "center",
          padding: "10px 16px",
          borderRadius: 8,
          maxWidth: "100%",
          pointerEvents: "auto",
        }}
      >
        {sentence.words.map((word, i) => (
          <span
            key={`${shownIndex}-${i}`}
            style={
              i === activeWord
                ? { fontWeight: 700, color: cssVar("accent") }
                : undefined
            }
          >
            {word.text}
            {i < sentence.words.length - 1 ? " " : ""}
          </span>
        ))}
        {!playing && onEditSentence ? (
          <button
            type="button"
            aria-label="Edit this sentence"
            onClick={() => onEditSentence(sentence.narrationId)}
            style={{
              marginLeft: 8,
              border: "none",
              background: "transparent",
              color: cssVar("accent"),
              cursor: "pointer",
              fontSize: 13,
              lineHeight: 1,
              verticalAlign: "baseline",
            }}
          >
            ✎
          </button>
        ) : null}
      </div>
    </CaptionFrame>
  );
}

function CaptionFrame({ children }: { children?: React.ReactNode }) {
  return (
    <div
      data-ciq-caption-bar=""
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: CAPTION_SAFE_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 18px",
        pointerEvents: "none",
      }}
    >
      {children}
    </div>
  );
}
