import {
  llmInferredThemeSchema,
  llmMergeResultSchema,
  llmPageExtractionSchema,
} from "@counseliq/course-schema";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  llmAuthoredUnitSchema,
  llmCompileStructureSchema,
  llmDraftQuestionSchema,
  llmJudgeCourseSchema,
} from "../compiler/schemas";

/**
 * JSON schemas for OpenRouter structured outputs, generated from the shared
 * Zod contracts. The Zod parse downstream remains the enforcement; these
 * only steer providers that support response_format: json_schema.
 */

/**
 * zodToJsonSchema emits `$ref: "#/definitions/OpenAiAnyType"` for open
 * records / unknown values even with $refStrategy "none" (the definition is
 * self-referential). Google rejects unresolved $refs ("reference to
 * undefined schema"), so replace every $ref node with the permissive empty
 * schema and drop the definitions block. The Zod parse downstream is the
 * enforcement either way.
 */
function stripRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripRefs);
  if (node === null || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === "string") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "definitions") continue;
    out[key] = stripRefs(value);
  }
  return out;
}

function toJsonSchema(schema: Parameters<typeof zodToJsonSchema>[0]) {
  const generated = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "openAi",
  });
  return stripRefs(generated) as Record<string, unknown>;
}

export const PAGE_EXTRACTION_JSON_SCHEMA = toJsonSchema(
  llmPageExtractionSchema
);
export const MERGE_RESULT_JSON_SCHEMA = toJsonSchema(llmMergeResultSchema);
export const INFERRED_THEME_JSON_SCHEMA = toJsonSchema(llmInferredThemeSchema);

// M4 compiler + judge (Zod sources in ../compiler/schemas.ts).
export const COMPILE_STRUCTURE_JSON_SCHEMA = toJsonSchema(
  llmCompileStructureSchema
);
export const AUTHOR_UNIT_JSON_SCHEMA = toJsonSchema(llmAuthoredUnitSchema);
export const JUDGE_COURSE_JSON_SCHEMA = toJsonSchema(llmJudgeCourseSchema);
export const DRAFT_QUESTION_JSON_SCHEMA = toJsonSchema(llmDraftQuestionSchema);
