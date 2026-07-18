/**
 * Per-task model routing for the extraction + compilation pipeline.
 *
 * Priority order: admin-configured model > env override > code default.
 * Eval runs record model + prompt version together, so swaps are measurable.
 *
 * Task requirements:
 * - extract-page:      vision (page PNG input), structured output. Moderate
 *                      context (one page + preamble).
 * - merge-inventory:   structured output, long context (all candidate
 *                      concepts from every page of every doc in the run).
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
 * - outline-course:    structured output, long context (reviewed inventory
 *                      + cleared asset summary + operator brief). The M6.5
 *                      editable outline pass, replacing compile-structure
 *                      in the gated flow.
 */

export const LLM_TASKS = [
  "extract-page",
  "merge-inventory",
  "compile-structure",
  "author-unit",
  "judge-course",
  "tag-asset",
  "outline-course",
  "assign-avatar-look",
  "evaluate-avatar-look",
] as const;

export type LlmTask = (typeof LLM_TASKS)[number];
export type LlmModelRouting = Record<LlmTask, string>;
export type LlmModelOverrides = Partial<LlmModelRouting>;
export type LlmModelSource = "config" | "env" | "default";

const DEFAULT_MODELS: LlmModelRouting = {
  "extract-page": "google/gemini-2.5-flash",
  "merge-inventory": "google/gemini-2.5-flash",
  "compile-structure": "google/gemini-2.5-flash",
  "author-unit": "google/gemini-2.5-flash",
  // Different family than the Gemini authoring tasks, deliberately.
  "judge-course": "anthropic/claude-sonnet-4.5",
  "tag-asset": "google/gemini-2.5-flash",
  "outline-course": "google/gemini-2.5-flash",
  "assign-avatar-look": "google/gemini-2.5-flash",
  "evaluate-avatar-look": "google/gemini-2.5-flash",
};

const ENV_OVERRIDES: Record<LlmTask, string> = {
  "extract-page": "MODEL_EXTRACT_PAGE",
  "merge-inventory": "MODEL_MERGE_INVENTORY",
  "compile-structure": "MODEL_COMPILE_STRUCTURE",
  "author-unit": "MODEL_AUTHOR_UNIT",
  "judge-course": "MODEL_JUDGE_COURSE",
  "tag-asset": "MODEL_TAG_ASSET",
  "outline-course": "MODEL_OUTLINE_COURSE",
  "assign-avatar-look": "MODEL_ASSIGN_AVATAR_LOOK",
  "evaluate-avatar-look": "MODEL_EVALUATE_AVATAR_LOOK",
};

function normalizedOverride(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function isLlmTask(value: string): value is LlmTask {
  return (LLM_TASKS as readonly string[]).includes(value);
}

export function defaultModelForTask(task: LlmTask): string {
  return DEFAULT_MODELS[task];
}

export function envOverrideVarForTask(task: LlmTask): string {
  return ENV_OVERRIDES[task];
}

/** Where a task's currently-resolved model comes from. */
export function modelSourceForTask(
  task: LlmTask,
  configuredOverrides?: LlmModelOverrides
): LlmModelSource {
  if (normalizedOverride(configuredOverrides?.[task])) {
    return "config";
  }
  if (normalizedOverride(process.env[ENV_OVERRIDES[task]])) {
    return "env";
  }
  return "default";
}

/**
 * Output-token caps per task. Sent as max_tokens on every request: bounds
 * worst-case cost per call, and OpenRouter's affordability check otherwise
 * assumes the model's maximum (65k for Gemini 2.5 Flash), which rejects
 * requests on credit-limited keys with a 402.
 */
const MAX_OUTPUT_TOKENS: Record<LlmTask, number> = {
  // Dense pages can exceed 4k JSON output when the model emits many facts,
  // entities, and quotes; 8k materially reduces mid-JSON truncation failures.
  "extract-page": 8192,
  "merge-inventory": 16384,
  // Reasoning models (Gemini 2.5) spend thinking tokens from the same
  // budget; a tight cap starves the JSON itself and truncates mid-string.
  "compile-structure": 16384,
  "author-unit": 16384,
  "judge-course": 16384,
  "tag-asset": 2048,
  "outline-course": 16384,
  "assign-avatar-look": 2048,
  "evaluate-avatar-look": 2048,
};

/** OpenRouter model string for a task (config > env > default). */
export function modelForTask(
  task: LlmTask,
  configuredOverrides?: LlmModelOverrides
): string {
  return (
    normalizedOverride(configuredOverrides?.[task]) ??
    normalizedOverride(process.env[ENV_OVERRIDES[task]]) ??
    DEFAULT_MODELS[task]
  );
}

/** max_tokens for a task's requests. */
export function maxTokensForTask(task: LlmTask): number {
  return MAX_OUTPUT_TOKENS[task];
}

/** All tasks with their currently-routed models (for runs.promptVersions). */
export function currentModelRouting(
  configuredOverrides?: LlmModelOverrides
): LlmModelRouting {
  return {
    "extract-page": modelForTask("extract-page", configuredOverrides),
    "merge-inventory": modelForTask("merge-inventory", configuredOverrides),
    "compile-structure": modelForTask("compile-structure", configuredOverrides),
    "author-unit": modelForTask("author-unit", configuredOverrides),
    "judge-course": modelForTask("judge-course", configuredOverrides),
    "tag-asset": modelForTask("tag-asset", configuredOverrides),
    "outline-course": modelForTask("outline-course", configuredOverrides),
    "assign-avatar-look": modelForTask("assign-avatar-look", configuredOverrides),
    "evaluate-avatar-look": modelForTask("evaluate-avatar-look", configuredOverrides),
  };
}
