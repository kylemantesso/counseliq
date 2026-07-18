import type { Infer } from "convex/values";
import { reviewGateValidator, runStateValidator } from "../schema";

export type RunState = Infer<typeof runStateValidator>;
export type ReviewGate = Infer<typeof reviewGateValidator>;

/**
 * The explicit run state machine. A transition is legal iff the target state
 * appears in the source state's list — plus the blanket rule that any
 * non-FAILED state may transition to FAILED.
 *
 * Source-doc conversion, extraction, and approval happen before runs start.
 * Legacy ingestion states remain for historical rows and recovery only. New
 * runs are created at OUTLINING. The QA judge runs on
 * the compiled course BEFORE any asset money is spent; gate 2 reviews the
 * compiled course as a whole (judge flags attached) and may send flagged
 * units back to COMPILING for re-authoring.
 *
 * M6.5: OUTLINING runs the structure pass (brief + approved facts + cleared
 * assets), parks at OUTLINE_REVIEW for operator editing, and only approval
 * starts authoring spend. OUTLINE_REVIEW → OUTLINING is
 * regenerate-with-feedback.
 */
export const ALLOWED_TRANSITIONS: Record<RunState, RunState[]> = {
  UPLOADED: ["CONVERTING", "OUTLINING"],
  CONVERTING: ["CONVERTED", "OUTLINING"],
  CONVERTED: ["EXTRACTING", "OUTLINING"],
  EXTRACTING: ["EXTRACTED", "OUTLINING"],
  GATE_1_KNOWLEDGE_REVIEW: ["OUTLINING", "COMPILING"],
  GATE_2_QUIZ_REVIEW: ["GENERATING_SCRIPT", "COMPILING"],
  EXTRACTED: ["OUTLINING"],
  OUTLINING: ["OUTLINE_REVIEW"],
  OUTLINE_REVIEW: ["COMPILING", "OUTLINING"],
  COMPILING: ["COMPILED"],
  COMPILED: ["QA_RUNNING"],
  QA_RUNNING: ["QA_PASSED", "QA_FLAGGED"],
  QA_PASSED: ["GATE_2_COURSE_REVIEW"],
  QA_FLAGGED: ["GATE_2_COURSE_REVIEW"],
  // Approve → asset generation; send-back → re-author flagged units.
  GATE_2_COURSE_REVIEW: ["GENERATING_SCRIPT", "COMPILING"],
  GENERATING_SCRIPT: ["GENERATING_ASSETS"],
  GENERATING_ASSETS: ["GENERATING_AVATAR", "GATE_3_PREVIEW"],
  GENERATING_AVATAR: ["GATE_3_PREVIEW"],
  // Approve → publish; reject → back to course review with reviewer notes.
  GATE_3_PREVIEW: ["PUBLISHING", "GATE_2_COURSE_REVIEW"],
  PUBLISHING: ["PUBLISHED"],
  PUBLISHED: [],
  FAILED: [],
};

export function isTransitionAllowed(from: RunState, to: RunState): boolean {
  if (to === "FAILED") {
    return from !== "FAILED";
  }
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** The run state a review gate corresponds to. */
export const GATE_STATES: Record<ReviewGate, RunState> = {
  // Legacy gate-1 rows can still exist in older deployments.
  1: "EXTRACTED",
  2: "GATE_2_COURSE_REVIEW",
  3: "GATE_3_PREVIEW",
};
