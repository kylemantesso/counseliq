import { useState } from "react";
import { cssVar } from "@counseliq/cards";
import type { PreviewQuestion } from "./types";

/**
 * Shared MCQ interaction for the hook (commit question) and retrieve
 * phases, ported from the design mockup: single select → correct option
 * highlighted, wrong pick marked, verdict + explanation, then continue.
 * Renders inside the 360×640 stage with brand tokens.
 */

export interface QuestionPanelProps {
  question: PreviewQuestion;
  kicker: string;
  continueLabel: string;
  onContinue: () => void;
}

const mono: React.CSSProperties = {
  fontFamily: cssVar("fontMono"),
  textTransform: "uppercase",
};

export function QuestionPanel({ question, kicker, continueLabel, onContinue }: QuestionPanelProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const correct = picked === question.correctIndex;

  return (
    <div
      data-ciq-question=""
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        padding: "16px 24px 14px",
        overflowY: "auto",
        background: cssVar("bg"),
        color: cssVar("ink"),
        fontFamily: cssVar("fontText"),
      }}
    >
      <div style={{ ...mono, fontSize: 10.5, letterSpacing: ".18em", color: cssVar("accent") }}>
        {kicker}
      </div>
      <div
        style={{
          fontFamily: cssVar("fontDisplay"),
          fontWeight: cssVar("displayWeight") as React.CSSProperties["fontWeight"],
          letterSpacing: cssVar("tracking"),
          textTransform: cssVar("titleCase") as React.CSSProperties["textTransform"],
          fontSize: 23,
          lineHeight: 1.22,
          marginTop: 12,
        }}
      >
        {question.prompt}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 18 }}>
        {question.options.map((option, i) => {
          const isCorrect = i === question.correctIndex;
          const isPicked = i === picked;
          const showCorrect = answered && isCorrect;
          const showWrongPick = answered && isPicked && !isCorrect;
          const dimmed = answered && !isCorrect && !isPicked;
          return (
            <button
              key={i}
              type="button"
              disabled={answered}
              onClick={() => setPicked(i)}
              aria-label={`Option ${i + 1}: ${option}`}
              style={{
                textAlign: "left",
                fontSize: 14,
                lineHeight: 1.35,
                padding: "12px 13px",
                borderRadius: cssVar("radius"),
                border: `1.5px solid ${showCorrect ? cssVar("accent") : cssVar("rule")}`,
                background: showCorrect ? cssVar("chip") : "transparent",
                color: "inherit",
                fontFamily: "inherit",
                opacity: dimmed ? 0.45 : 1,
                cursor: answered ? "default" : "pointer",
                display: "flex",
                gap: 10,
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  ...mono,
                  fontSize: 11,
                  flex: "0 0 auto",
                  color: showCorrect ? cssVar("accent") : showWrongPick ? cssVar("dim") : cssVar("dim"),
                }}
              >
                {showCorrect ? "✓" : showWrongPick ? "✕" : String.fromCharCode(65 + i)}
              </span>
              <span>{option}</span>
            </button>
          );
        })}
      </div>
      {answered ? (
        <>
          <div style={{ marginTop: 14, paddingLeft: 12, borderLeft: `3px solid ${cssVar("accent")}` }}>
            <div
              style={{
                ...mono,
                fontSize: 9.5,
                letterSpacing: ".14em",
                color: correct ? cssVar("accent") : cssVar("dim"),
              }}
            >
              {correct ? "Correct" : "Not quite"}
            </div>
            <div style={{ fontSize: 13.5, color: cssVar("dim"), lineHeight: 1.45, marginTop: 5 }}>
              {question.explanation}
            </div>
          </div>
          <button
            type="button"
            onClick={onContinue}
            style={{
              ...mono,
              width: "100%",
              minHeight: 48,
              border: 0,
              borderRadius: 999,
              background: cssVar("accent"),
              color: cssVar("accentInk"),
              fontSize: 12.5,
              letterSpacing: ".1em",
              cursor: "pointer",
              fontWeight: 500,
              marginTop: 16,
              flex: "0 0 auto",
            }}
          >
            {continueLabel}
          </button>
        </>
      ) : null}
      <div style={{ height: 10, flex: "0 0 auto" }} />
    </div>
  );
}
