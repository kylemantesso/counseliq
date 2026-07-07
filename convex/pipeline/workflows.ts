import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";

export const workflow = new WorkflowManager(components.workflow);

const ACTOR = "workflow";

/**
 * Phase 1: UPLOADED -> CONVERTING -> CONVERTED -> EXTRACTING -> EXTRACTED,
 * then park the run at gate 1 with one review item per flagged fact. The
 * compiler runs AFTER gate 1 (M4 resequencing) so it only ever consumes the
 * reviewed inventory.
 */
export const ingestAndExtract = workflow
  .define({
    args: { runId: v.id("runs") },
  })
  .handler(async (step, args): Promise<void> => {
    const { runId } = args;

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "CONVERTING",
      actor: ACTOR,
      detail: "ingestAndCompile: dispatching source doc conversion",
    });
    const conversion: { status: string; cause?: string } =
      await step.runAction(
        internal.pipeline.ingestion.dispatchAndAwaitConversions,
        { runId }
      );
    if (conversion.status === "empty") {
      // No source docs on the run (M1-style walkthroughs, tests): nothing to
      // convert, advance directly.
      await step.runMutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "CONVERTED",
        actor: ACTOR,
        detail: "ingestAndExtract: no source docs to convert",
      });
    } else if (conversion.status === "timeout") {
      await step.runMutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "FAILED",
        actor: ACTOR,
        detail: "ingestAndExtract: conversion timed out",
        error: {
          retryable: true,
          cause: conversion.cause ?? "conversion timed out",
        },
      });
      return;
    }
    // status === "converted": the callback already transitioned the run to
    // CONVERTED when the final source doc landed.

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "EXTRACTING",
      actor: ACTOR,
      detail: "ingestAndExtract: starting extraction",
    });
    const extraction: {
      status: string;
      cause?: string;
      counts?: {
        total: number;
        concepts: number;
        facts: number;
        entities: number;
        quotes: number;
        flaggedFacts: number;
      };
      pages?: number;
    } = await step.runAction(internal.pipeline.extract.runExtraction, {
      runId,
    });
    if (extraction.status !== "ok") {
      await step.runMutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "FAILED",
        actor: ACTOR,
        detail: "ingestAndExtract: extraction failed",
        error: {
          retryable: true,
          cause: extraction.cause ?? "extraction failed",
        },
      });
      return;
    }
    const counts = extraction.counts;
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "EXTRACTED",
      actor: ACTOR,
      detail:
        `ingestAndExtract: extraction complete — ${counts?.total ?? 0} inventory items ` +
        `(${counts?.concepts ?? 0} concepts, ${counts?.facts ?? 0} facts, ` +
        `${counts?.flaggedFacts ?? 0} flagged) from ${extraction.pages ?? 0} page(s)`,
    });

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "GATE_1_KNOWLEDGE_REVIEW",
      actor: ACTOR,
      detail: "ingestAndExtract: awaiting knowledge review",
    });
    await step.runMutation(internal.pipeline.reviewItems.createGateReviewItems, {
      runId,
      gate: 1,
    });
  });

/**
 * Phase 2: COMPILING -> COMPILED -> QA_RUNNING -> QA_PASSED | QA_FLAGGED,
 * then park the run at gate 2 (course review). Started by decideGate(1)
 * approval (full compile) or by adminSendBackForReauthoring (partial
 * re-authoring of flagged units) — both transition the run to COMPILING
 * before starting this workflow.
 */
export const compileAndJudge = workflow
  .define({
    args: {
      runId: v.id("runs"),
      reAuthorUnitIds: v.optional(v.array(v.id("microUnits"))),
    },
  })
  .handler(async (step, args): Promise<void> => {
    const { runId } = args;

    const compilation: {
      status: string;
      cause?: string;
      unitCount?: number;
      moduleCount?: number;
      questionCount?: number;
    } = await step.runAction(
      internal.pipeline.compiler.compile.runCompilation,
      {
        runId,
        ...(args.reAuthorUnitIds !== undefined
          ? { reAuthorUnitIds: args.reAuthorUnitIds }
          : {}),
      }
    );
    if (compilation.status !== "ok") {
      await step.runMutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "FAILED",
        actor: ACTOR,
        detail: "compileAndJudge: compilation failed",
        error: {
          retryable: true,
          cause: compilation.cause ?? "compilation failed",
        },
      });
      return;
    }
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "COMPILED",
      actor: ACTOR,
      detail:
        `compileAndJudge: compiled ${compilation.unitCount ?? 0} micro-unit(s) across ` +
        `${compilation.moduleCount ?? 0} module(s) with ${compilation.questionCount ?? 0} question(s)`,
    });

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "QA_RUNNING",
      actor: ACTOR,
      detail: "compileAndJudge: running QA judge",
    });
    await step.runAction(internal.pipeline.steps.runNoopStage, {
      runId,
      stage: "qa-judge",
    });
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "QA_PASSED",
      actor: ACTOR,
      detail: "compileAndJudge: QA judge passed the course (no-op)",
    });

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "GATE_2_COURSE_REVIEW",
      actor: ACTOR,
      detail: "compileAndJudge: awaiting course review",
    });
  });

/**
 * Phase 3: GENERATING_SCRIPT -> GENERATING_ASSETS (both no-op stubs until
 * M5), then park the run at gate 3 with placeholder review items. Started by
 * decideGate(2), which has already transitioned the run to GENERATING_SCRIPT.
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
      toState: "GATE_3_PREVIEW",
      actor: ACTOR,
      detail: "generateAssets: assets generated (no-op), awaiting preview review",
    });
    await step.runMutation(internal.pipeline.reviewItems.createGateReviewItems, {
      runId,
      gate: 3,
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
