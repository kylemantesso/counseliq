import { useEffect, useState } from "react";
import { QuestionPanel } from "./question-panel.web";
import type { PreviewQuestion } from "./types";

/**
 * Retrieve questions shown INLINE after content (the design mockup defers
 * these to the adaptive scheduler; the gate-3 studio reviews them here).
 */
export function RetrievePhase({
  questions,
  onDone,
}: {
  questions: PreviewQuestion[];
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const empty = questions.length === 0;

  // An empty retrieve list skips the phase — via effect, never mid-render.
  useEffect(() => {
    if (empty) onDone();
  }, [empty, onDone]);

  if (empty) return null;
  const clamped = Math.min(index, questions.length - 1);
  const last = clamped === questions.length - 1;
  return (
    <QuestionPanel
      key={questions[clamped].id}
      question={questions[clamped]}
      kicker={`Retrieve · ${clamped + 1} of ${questions.length}`}
      continueLabel={last ? "Continue" : "Next question"}
      onContinue={() => (last ? onDone() : setIndex(clamped + 1))}
    />
  );
}
