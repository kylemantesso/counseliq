import type { Infer } from "convex/values";
import { reviewGateValidator, runStateValidator } from "../schema";

export type RunState = Infer<typeof runStateValidator>;
export type ReviewGate = Infer<typeof reviewGateValidator>;

/**
 * The explicit run state machine. A transition is legal iff the target state
 * appears in the source state's list — plus the blanket rule that any
 * non-FAILED state may transition to FAILED.
 */
export const ALLOWED_TRANSITIONS: Record<RunState, RunState[]> = {
  UPLOADED: ["CONVERTING"],
  CONVERTING: ["CONVERTED"],
  CONVERTED: ["EXTRACTING"],
  EXTRACTING: ["EXTRACTED"],
  EXTRACTED: ["COMPILING"],
  COMPILING: ["COMPILED"],
  COMPILED: ["GATE_1_KNOWLEDGE_REVIEW"],
  GATE_1_KNOWLEDGE_REVIEW: ["GENERATING_SCRIPT"],
  GENERATING_SCRIPT: ["GENERATING_ASSETS"],
  GENERATING_ASSETS: ["QA_RUNNING"],
  QA_RUNNING: ["QA_PASSED"],
  QA_PASSED: ["GATE_2_QUIZ_REVIEW"],
  GATE_2_QUIZ_REVIEW: ["GATE_3_PREVIEW"],
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
  2: "GATE_2_QUIZ_REVIEW",
  3: "GATE_3_PREVIEW",
};
