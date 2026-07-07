import type { Infer } from "convex/values";
import { reviewGateValidator, runStateValidator } from "../schema";

export type RunState = Infer<typeof runStateValidator>;
export type ReviewGate = Infer<typeof reviewGateValidator>;

/**
 * The explicit run state machine. A transition is legal iff the target state
 * appears in the source state's list — plus the blanket rule that any
 * non-FAILED state may transition to FAILED.
 *
 * M4 resequencing (sanctioned contract change): gate 1 (knowledge review)
 * comes BEFORE compilation so the compiler only ever consumes reviewed facts;
 * the QA judge runs on the compiled course BEFORE any asset money is spent;
 * gate 2 reviews the compiled course as a whole (judge flags attached) and
 * may send flagged units back to COMPILING for re-authoring.
 */
export const ALLOWED_TRANSITIONS: Record<RunState, RunState[]> = {
  UPLOADED: ["CONVERTING"],
  CONVERTING: ["CONVERTED"],
  CONVERTED: ["EXTRACTING"],
  EXTRACTING: ["EXTRACTED"],
  EXTRACTED: ["GATE_1_KNOWLEDGE_REVIEW"],
  GATE_1_KNOWLEDGE_REVIEW: ["COMPILING"],
  COMPILING: ["COMPILED"],
  COMPILED: ["QA_RUNNING"],
  QA_RUNNING: ["QA_PASSED", "QA_FLAGGED"],
  QA_PASSED: ["GATE_2_COURSE_REVIEW"],
  QA_FLAGGED: ["GATE_2_COURSE_REVIEW"],
  // Approve → asset generation; send-back → re-author flagged units.
  GATE_2_COURSE_REVIEW: ["GENERATING_SCRIPT", "COMPILING"],
  GENERATING_SCRIPT: ["GENERATING_ASSETS"],
  GENERATING_ASSETS: ["GATE_3_PREVIEW"],
  GATE_3_PREVIEW: ["PUBLISHED"],
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
  1: "GATE_1_KNOWLEDGE_REVIEW",
  2: "GATE_2_COURSE_REVIEW",
  3: "GATE_3_PREVIEW",
};
