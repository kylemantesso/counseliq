import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { runStateValidator } from "../schema";
import { AppErrorCode, appError } from "../errors";
import { isTransitionAllowed, type RunState } from "./states";

type TransitionArgs = {
  runId: Id<"runs">;
  toState: RunState;
  actor: string;
  detail?: string;
  error?: { retryable: boolean; cause: string };
};

/**
 * The single place where runs.state is written after creation. Everything —
 * workflows, gate decisions, failure paths — funnels through here so every
 * state change is validated against the transition map and journaled to
 * runEvents.
 */
export async function applyRunTransition(
  ctx: MutationCtx,
  args: TransitionArgs
): Promise<void> {
  const run = await ctx.db.get(args.runId);
  if (!run) {
    appError(AppErrorCode.RUN_NOT_FOUND);
  }

  if (!isTransitionAllowed(run.state, args.toState)) {
    console.error(
      `[pipeline] illegal transition ${run.state} -> ${args.toState} for run ${args.runId}`
    );
    appError(AppErrorCode.RUN_TRANSITION_INVALID);
  }

  await ctx.db.patch(args.runId, {
    state: args.toState,
    ...(args.toState === "FAILED" && args.error ? { error: args.error } : {}),
  });

  await ctx.db.insert("runEvents", {
    runId: args.runId,
    fromState: run.state,
    toState: args.toState,
    actor: args.actor,
    ...(args.detail !== undefined ? { detail: args.detail } : {}),
  });

  console.log(
    `[pipeline] run ${args.runId}: ${run.state} -> ${args.toState} (${args.actor})`
  );
}

export const transitionRun = internalMutation({
  args: {
    runId: v.id("runs"),
    toState: runStateValidator,
    actor: v.string(),
    detail: v.optional(v.string()),
    error: v.optional(
      v.object({
        retryable: v.boolean(),
        cause: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    await applyRunTransition(ctx, args);
    return null;
  },
});
