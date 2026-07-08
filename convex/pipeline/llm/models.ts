/**
 * Per-task model routing for the extraction + compilation pipeline.
 *
 * Changing the model for a task is a one-line change here (or an env var on
 * the Convex deployment — env always wins). Eval runs record model + prompt
 * version together, so swaps are measurable.
 *
 * Task requirements:
 * - extract-page:      vision (page PNG input), structured output. Moderate
 *                      context (one page + preamble).
 * - merge-inventory:   structured output, long context (all candidate
 *                      concepts from every page of every doc in the run).
 * - infer-theme:       vision (2-3 page renders), structured output.
 * - compile-structure: structured output, long context (the whole reviewed
 *                      inventory).
 * - author-unit:       structured output; drafts narration, cards, and
 *                      questions for one micro-unit.
 * - judge-course:      structured output, long context (full compiled
 *                      course + inventory). MUST be routed to a different
 *                      model family than the authoring tasks — self-review
 *                      by sibling models is weaker adversarial pressure.
 * - tag-asset:         vision (asset image / video poster), structured
 *                      output. Batch workload — cheap model. NEVER outputs
 *                      rights (the output schema has no such field).
 */

export type LlmTask =
  | "extract-page"
  | "merge-inventory"
  | "infer-theme"
  | "compile-structure"
  | "author-unit"
  | "judge-course"
  | "tag-asset";

const DEFAULT_MODELS: Record<LlmTask, string> = {
  "extract-page": "google/gemini-2.5-flash",
  "merge-inventory": "google/gemini-2.5-flash",
  "infer-theme": "google/gemini-2.5-flash",
  "compile-structure": "google/gemini-2.5-flash",
  "author-unit": "google/gemini-2.5-flash",
  // Different family than the Gemini authoring tasks, deliberately.
  "judge-course": "anthropic/claude-sonnet-4.5",
  "tag-asset": "google/gemini-2.5-flash",
};

const ENV_OVERRIDES: Record<LlmTask, string> = {
  "extract-page": "MODEL_EXTRACT_PAGE",
  "merge-inventory": "MODEL_MERGE_INVENTORY",
  "infer-theme": "MODEL_INFER_THEME",
  "compile-structure": "MODEL_COMPILE_STRUCTURE",
  "author-unit": "MODEL_AUTHOR_UNIT",
  "judge-course": "MODEL_JUDGE_COURSE",
  "tag-asset": "MODEL_TAG_ASSET",
};

/**
 * Output-token caps per task. Sent as max_tokens on every request: bounds
 * worst-case cost per call, and OpenRouter's affordability check otherwise
 * assumes the model's maximum (65k for Gemini 2.5 Flash), which rejects
 * requests on credit-limited keys with a 402.
 */
const MAX_OUTPUT_TOKENS: Record<LlmTask, number> = {
  "extract-page": 4096,
  "merge-inventory": 16384,
  "infer-theme": 2048,
  // Reasoning models (Gemini 2.5) spend thinking tokens from the same
  // budget; a tight cap starves the JSON itself and truncates mid-string.
  "compile-structure": 16384,
  "author-unit": 16384,
  "judge-course": 16384,
  "tag-asset": 2048,
};

/** OpenRouter model string for a task (env override > default). */
export function modelForTask(task: LlmTask): string {
  const override = process.env[ENV_OVERRIDES[task]];
  return override && override.trim() !== ""
    ? override.trim()
    : DEFAULT_MODELS[task];
}

/** max_tokens for a task's requests. */
export function maxTokensForTask(task: LlmTask): number {
  return MAX_OUTPUT_TOKENS[task];
}

/** All tasks with their currently-routed models (for runs.promptVersions). */
export function currentModelRouting(): Record<LlmTask, string> {
  return {
    "extract-page": modelForTask("extract-page"),
    "merge-inventory": modelForTask("merge-inventory"),
    "infer-theme": modelForTask("infer-theme"),
    "compile-structure": modelForTask("compile-structure"),
    "author-unit": modelForTask("author-unit"),
    "judge-course": modelForTask("judge-course"),
    "tag-asset": modelForTask("tag-asset"),
  };
}
