/**
 * Per-task model routing for the extraction pipeline.
 *
 * Changing the model for a task is a one-line change here (or an env var on
 * the Convex deployment — env always wins). Eval runs record model + prompt
 * version together, so swaps are measurable.
 *
 * Task requirements:
 * - extract-page:    vision (page PNG input), structured output. Moderate
 *                    context (one page + preamble).
 * - merge-inventory: structured output, long context (all candidate concepts
 *                    from every page of every doc in the run).
 * - infer-theme:     vision (2-3 page renders), structured output.
 */

export type LlmTask = "extract-page" | "merge-inventory" | "infer-theme";

const DEFAULT_MODELS: Record<LlmTask, string> = {
  "extract-page": "google/gemini-2.5-flash",
  "merge-inventory": "google/gemini-2.5-flash",
  "infer-theme": "google/gemini-2.5-flash",
};

const ENV_OVERRIDES: Record<LlmTask, string> = {
  "extract-page": "MODEL_EXTRACT_PAGE",
  "merge-inventory": "MODEL_MERGE_INVENTORY",
  "infer-theme": "MODEL_INFER_THEME",
};

/** OpenRouter model string for a task (env override > default). */
export function modelForTask(task: LlmTask): string {
  const override = process.env[ENV_OVERRIDES[task]];
  return override && override.trim() !== ""
    ? override.trim()
    : DEFAULT_MODELS[task];
}

/** All tasks with their currently-routed models (for runs.promptVersions). */
export function currentModelRouting(): Record<LlmTask, string> {
  return {
    "extract-page": modelForTask("extract-page"),
    "merge-inventory": modelForTask("merge-inventory"),
    "infer-theme": modelForTask("infer-theme"),
  };
}
