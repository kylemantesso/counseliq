import {
  llmInferredThemeSchema,
  llmMergeResultSchema,
  llmPageExtractionSchema,
} from "@counseliq/course-schema";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * JSON schemas for OpenRouter structured outputs, generated from the shared
 * Zod contracts. The Zod parse downstream remains the enforcement; these
 * only steer providers that support response_format: json_schema.
 */

function toJsonSchema(schema: Parameters<typeof zodToJsonSchema>[0]) {
  return zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "openAi",
  }) as Record<string, unknown>;
}

export const PAGE_EXTRACTION_JSON_SCHEMA = toJsonSchema(
  llmPageExtractionSchema
);
export const MERGE_RESULT_JSON_SCHEMA = toJsonSchema(llmMergeResultSchema);
export const INFERRED_THEME_JSON_SCHEMA = toJsonSchema(llmInferredThemeSchema);
