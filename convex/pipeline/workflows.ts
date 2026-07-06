import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";

export const workflow = new WorkflowManager(components.workflow);

const ACTOR = "workflow";

/**
 * Phase 1: UPLOADED -> EXTRACTING -> EXTRACTED -> COMPILING -> COMPILED,
 * then park the run at gate 1 with placeholder review items.
 */
export const ingestAndCompile = workflow
  .define({
    args: { runId: v.id("runs") },
  })
  .handler(async (step, args): Promise<void> => {
    const { runId } = args;

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "EXTRACTING",
      actor: ACTOR,
      detail: "ingestAndCompile: starting extraction",
    });
    await step.runAction(internal.pipeline.steps.runNoopStage, {
      runId,
      stage: "extract",
    });
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "EXTRACTED",
      actor: ACTOR,
      detail: "ingestAndCompile: extraction complete (no-op)",
    });

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "COMPILING",
      actor: ACTOR,
      detail: "ingestAndCompile: starting compilation",
    });
    await step.runAction(internal.pipeline.steps.runNoopStage, {
      runId,
      stage: "compile",
    });
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "COMPILED",
      actor: ACTOR,
      detail: "ingestAndCompile: compilation complete (no-op)",
    });

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "GATE_1_KNOWLEDGE_REVIEW",
      actor: ACTOR,
      detail: "ingestAndCompile: awaiting knowledge review",
    });
    await step.runMutation(internal.pipeline.reviewItems.createGateReviewItems, {
      runId,
      gate: 1,
    });
  });

/**
 * Phase 2: GENERATING_SCRIPT -> GENERATING_ASSETS -> QA_RUNNING -> QA_PASSED,
 * then park the run at gate 2 with placeholder review items. Started by
 * decideGate(1), which has already transitioned the run to GENERATING_SCRIPT.
 */
export const generateAssets = workflow
  .define({
    args: { runId: v.id("runs") },
  })
  .handler(async (step, args): Promise<void> => {
    const { runId } = args;

    await step.runAction(internal.pipeline.steps.runNoopStage, {
      runId,
      stage: "generate-script",
    });
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "GENERATING_ASSETS",
      actor: ACTOR,
      detail: "generateAssets: script generated (no-op), generating assets",
    });

    await step.runAction(internal.pipeline.steps.runNoopStage, {
      runId,
      stage: "generate-assets",
    });
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "QA_RUNNING",
      actor: ACTOR,
      detail: "generateAssets: assets generated (no-op), running QA",
    });

    await step.runAction(internal.pipeline.steps.runNoopStage, {
      runId,
      stage: "qa",
    });
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "QA_PASSED",
      actor: ACTOR,
      detail: "generateAssets: QA passed (no-op)",
    });

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "GATE_2_QUIZ_REVIEW",
      actor: ACTOR,
      detail: "generateAssets: awaiting quiz review",
    });
    await step.runMutation(internal.pipeline.reviewItems.createGateReviewItems, {
      runId,
      gate: 2,
    });
  });

/**
 * Phase 3: GATE_3_PREVIEW -> PUBLISHED. Started by decideGate(3).
 */
export const publishPhase = workflow
  .define({
    args: { runId: v.id("runs") },
  })
  .handler(async (step, args): Promise<void> => {
    const { runId } = args;

    await step.runAction(internal.pipeline.steps.runNoopStage, {
      runId,
      stage: "publish",
    });
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "PUBLISHED",
      actor: ACTOR,
      detail: "publishPhase: run published",
    });
  });
