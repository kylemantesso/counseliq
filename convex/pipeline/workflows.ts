import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";

export const workflow = new WorkflowManager(components.workflow);

const ACTOR = "workflow";

/**
 * M6.5: the outline step. Runs the outline pass (brief + approved facts +
 * cleared assets) and parks the run at OUTLINE_REVIEW for operator
 * editing/approval. Started at course creation and by regenerate-with-feedback;
 * authoring spend only begins when the operator approves the outline
 * (approveOutline -> compileAndJudge).
 */
export const generateOutline = workflow
  .define({
    args: { runId: v.id("runs") },
  })
  .handler(async (step, args): Promise<void> => {
    const { runId } = args;

    const outline: { status: string; cause?: string; warning?: string } = await step.runAction(
      internal.pipeline.compiler.outline.runOutlineGeneration,
      { runId }
    );
    if (outline.status !== "ok") {
      await step.runMutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "FAILED",
        actor: ACTOR,
        detail: "generateOutline: outline pass failed",
        error: {
          retryable: true,
          cause: outline.cause ?? "outline pass failed",
        },
      });
      return;
    }
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "OUTLINE_REVIEW",
      actor: ACTOR,
      detail: outline.warning
        ? `generateOutline: outline ready for review (${outline.warning})`
        : "generateOutline: outline ready for review",
    });
  });

/**
 * Phase 2: COMPILING -> COMPILED -> QA_RUNNING -> QA_PASSED | QA_FLAGGED,
 * then park the run at gate 2 (course review). Started by outline approval
 * (full compile) or by adminSendBackForReauthoring (partial re-authoring of
 * flagged units) — both transition the run to COMPILING before starting this
 * workflow.
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
      warning?: string;
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
        `${compilation.moduleCount ?? 0} module(s) with ${compilation.questionCount ?? 0} question(s)` +
        (compilation.warning ? ` (${compilation.warning})` : ""),
    });

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "QA_RUNNING",
      actor: ACTOR,
      detail: "compileAndJudge: running QA judge",
    });
    const judged: {
      status: string;
      cause?: string;
      errorCount?: number;
      warningCount?: number;
    } = await step.runAction(internal.pipeline.compiler.judge.runQaJudge, {
      runId,
    });
    if (judged.status === "failed") {
      await step.runMutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "FAILED",
        actor: ACTOR,
        detail: "compileAndJudge: QA judge failed",
        error: {
          retryable: true,
          cause: judged.cause ?? "QA judge failed",
        },
      });
      return;
    }
    await step.runAction(internal.pipeline.avatar.assign.assignUnitLooks, { runId });
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: judged.status === "flagged" ? "QA_FLAGGED" : "QA_PASSED",
      actor: ACTOR,
      detail:
        `compileAndJudge: QA judge ${judged.status} the course — ` +
        `${judged.errorCount ?? 0} error(s), ${judged.warningCount ?? 0} warning(s)`,
    });

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "GATE_2_COURSE_REVIEW",
      actor: ACTOR,
      detail: "compileAndJudge: awaiting course review",
    });
  });

/**
 * Phase 3: GENERATING_SCRIPT (real as of M5: deterministic narration
 * normalisation; units with unresolved lexicon pronunciations become
 * blocked) -> GENERATING_ASSETS (no-op stub until M5 C2), then park the run
 * at gate 3. Started by decideGate(2), which has already transitioned the
 * run to GENERATING_SCRIPT.
 */
export const generateAssets = workflow
  .define({
    args: { runId: v.id("runs") },
  })
  .handler(async (step, args): Promise<void> => {
    const { runId } = args;

    const scripts: {
      scriptReady: number;
      blocked: number;
      unchanged: number;
    } = await step.runMutation(internal.pipeline.tts.script.generateScripts, {
      runId,
    });
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "GENERATING_ASSETS",
      actor: ACTOR,
      detail:
        `generateAssets: generate-script — ${scripts.scriptReady} script-ready, ` +
        `${scripts.blocked} blocked, ${scripts.unchanged} unchanged`,
    });

    const assets: {
      status: string;
      cause?: string;
      synthesized: number;
      cached: number;
      blockedSkipped: number;
      failed: Array<{ unitKey: string; cause: string }>;
      characters: number;
      costUsd: number;
    } = await step.runAction(
      internal.pipeline.tts.synthesize.runAssetGeneration,
      { runId }
    );
    if (assets.status === "failed") {
      await step.runMutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "FAILED",
        actor: ACTOR,
        detail: "generateAssets: TTS synthesis failed",
        error: {
          retryable: true,
          cause: assets.cause ?? "TTS synthesis failed",
        },
      });
      return;
    }
    const avatar = await step.runMutation(internal.pipeline.avatar.jobs.prepareAvatarGeneration, {
      runId,
    });
    if (avatar.enabled) {
      await step.runMutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "GENERATING_AVATAR",
        actor: ACTOR,
        detail:
          `generateAssets: ${avatar.queued} continuous narration track(s) ready for avatar video`,
      });
      await step.runAction(internal.pipeline.avatar.heygen.dispatchQueuedAvatarJobs, {
        runId,
      });
      return;
    }

    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "GATE_3_PREVIEW",
      actor: ACTOR,
      detail:
        `generateAssets: generate-assets — ${assets.synthesized} synthesized, ` +
        `${assets.cached} cached, ${assets.failed.length} failed, ` +
        `${assets.blockedSkipped} blocked; ${assets.characters} character(s), ` +
        `~$${assets.costUsd.toFixed(4)} (estimated)`,
    });
  });

/**
 * Phase 4 (M5): PUBLISHING -> PUBLISHED. Started by decideGate(3), which has
 * already transitioned the run to PUBLISHING. Assembles + validates the
 * Course Definition export, uploads export/timing/manifest artifacts to the
 * content-addressed store, and freezes the course (courseVersions row).
 */
export const publishPhase = workflow
  .define({
    args: { runId: v.id("runs") },
  })
  .handler(async (step, args): Promise<void> => {
    const { runId } = args;

    const published: {
      status: string;
      cause?: string;
      exportKey?: string;
      manifestKey?: string;
      specHash?: string;
      version?: number;
      warnings?: string[];
    } = await step.runAction(internal.pipeline.publish.runPublish, { runId });
    if (published.status !== "ok") {
      await step.runMutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "FAILED",
        actor: ACTOR,
        detail: "publishPhase: publish failed",
        error: {
          retryable: true,
          cause: published.cause ?? "publish failed",
        },
      });
      return;
    }
    const warningSuffix =
      published.warnings !== undefined && published.warnings.length > 0
        ? ` — warnings: ${published.warnings.join("; ")}`
        : "";
    await step.runMutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "PUBLISHED",
      actor: ACTOR,
      detail:
        `publishPhase: published v${published.version} — export ${published.exportKey}, ` +
        `manifest ${published.manifestKey}, specHash ${published.specHash}` +
        warningSuffix,
    });
  });
