import type { Doc } from "../../../../convex/_generated/dataModel";

type ActiveRunState = Exclude<Doc<"runs">["state"], "FAILED">;

const RUN_PHASE_INDEX: Record<ActiveRunState, number> = {
  UPLOADED: 0,
  CONVERTING: 0,
  CONVERTED: 0,
  EXTRACTING: 0,
  EXTRACTED: 0,
  GATE_1_KNOWLEDGE_REVIEW: 0,
  OUTLINING: 1,
  OUTLINE_REVIEW: 1,
  COMPILING: 2,
  COMPILED: 2,
  QA_RUNNING: 2,
  QA_PASSED: 2,
  QA_FLAGGED: 2,
  GATE_2_COURSE_REVIEW: 2,
  GATE_2_QUIZ_REVIEW: 2,
  GENERATING_SCRIPT: 3,
  GENERATING_ASSETS: 3,
  GENERATING_AVATAR: 3,
  GATE_3_PREVIEW: 3,
  PUBLISHING: 4,
  PUBLISHED: 4,
};

export function phaseIndexForRunState(state: string): number | null {
  return Object.prototype.hasOwnProperty.call(RUN_PHASE_INDEX, state)
    ? RUN_PHASE_INDEX[state as ActiveRunState]
    : null;
}
