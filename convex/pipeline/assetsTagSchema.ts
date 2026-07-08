import { z } from "zod";
import { ASSET_SUGGESTED_USES } from "@counseliq/course-schema";

/**
 * LLM wire contract for the tag-asset pass (M6). Deliberately has NO
 * `rights` field — rights are operator-declared and no model output can
 * ever reach that column. `identifiablePeople` from the model is a floor,
 * not a verdict: the save path may raise it to true but only a human can
 * lower it. Optional-ish fields are nullable on the wire (strict
 * structured outputs require every property present).
 */
export const llmAssetTagsSchema = z
  .object({
    /** One concrete sentence describing what the asset shows. */
    caption: z.string().min(1),
    /** 3-8 lowercase kebab-case retrieval tags. */
    tags: z.array(z.string().min(1)).min(1).max(12),
    /** Named/visible subjects (buildings, activities, equipment). */
    subjects: z.array(z.string().min(1)),
    /** e.g. "lecture theatre", "campus lawn"; null when unclear. */
    setting: z.string().min(1).nullable(),
    /** Verbatim legible text in the frame; null when none. */
    textInImage: z.string().min(1).nullable(),
    /** 0..1 — sharpness, composition, usefulness as course imagery. */
    qualityScore: z.number().min(0).max(1),
    /** Conservative: ANY visible face ⇒ true. */
    identifiablePeople: z.boolean(),
    suggestedUses: z.array(z.enum(ASSET_SUGGESTED_USES)),
  })
  .strict();

export type LlmAssetTags = z.infer<typeof llmAssetTagsSchema>;
