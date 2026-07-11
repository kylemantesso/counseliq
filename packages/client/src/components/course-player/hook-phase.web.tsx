import { cssVar } from "@counseliq/cards";
import { QuestionPanel } from "./question-panel.web";
import type { PreviewQuestion } from "./types";

/** The commit question — answer before the lesson plays. */
export function HookPhase({
  question,
  onDone,
}: {
  question: PreviewQuestion | null;
  onDone: () => void;
}) {
  if (!question) {
    return (
      <MissingQuestion label="Hook question not found in the question bank." onDone={onDone} />
    );
  }
  return (
    <QuestionPanel
      question={question}
      kicker="Commit — answer before we teach it"
      continueLabel="Play the lesson"
      onContinue={onDone}
    />
  );
}

function MissingQuestion({ label, onDone }: { label: string; onDone: () => void }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 24,
        background: cssVar("bg"),
        color: cssVar("dim"),
        fontFamily: cssVar("fontText"),
        fontSize: 13.5,
        textAlign: "center",
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        onClick={onDone}
        style={{
          border: `1.5px solid ${cssVar("accent")}`,
          borderRadius: 999,
          background: "transparent",
          color: cssVar("accent"),
          fontFamily: cssVar("fontMono"),
          fontSize: 12,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          padding: "10px 20px",
          cursor: "pointer",
        }}
      >
        Continue
      </button>
    </div>
  );
}
