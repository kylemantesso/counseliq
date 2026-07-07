import { z } from "zod";

/**
 * Knowledge inventory contract — shared between the Convex extraction
 * pipeline (convex/pipeline, which writes inventoryItems), the eval harness
 * (scripts/eval.mjs), and the admin UI. The EXTRACTING phase produces these
 * items from converted pages; the compiler (M4) consumes them.
 */

/**
 * Page provenance ID: `doc:{sourceDocId}:page:{n}` (matches
 * slides.provenanceId written by the conversion callback).
 */
export const PROVENANCE_ID_PATTERN = /^doc:[A-Za-z0-9]+:page:[1-9][0-9]*$/;

export const provenanceIdSchema = z
  .string()
  .regex(PROVENANCE_ID_PATTERN, "provenance must be doc:{sourceDocId}:page:{n}");

export const claimClassSchema = z.enum([
  "institution_claim",
  "regulatory_fact",
  "statistic",
  "structural",
]);

export const entityKindSchema = z.enum([
  "course",
  "campus",
  "date",
  "money",
  "person",
  "org",
  "program",
]);

/** Flag reason applied by the code-level floor (never by the LLM). */
export const FLAG_REASON_MISSING_SOURCE_OR_YEAR = "missing-source-or-year";

// --- Stored inventory items (discriminated on `type`) ---

export const conceptSchema = z
  .object({
    type: z.literal("concept"),
    /** Stable slug-like key, unique within a run's inventory. */
    key: z.string().min(1),
    title: z.string().min(1),
    summary: z.string(),
    pageProvenance: z.array(provenanceIdSchema).min(1),
  })
  .strict();

export const factSchema = z
  .object({
    type: z.literal("fact"),
    /** Key of the concept this fact supports. */
    conceptKey: z.string().min(1),
    statement: z.string().min(1),
    claimClass: claimClassSchema,
    provenance: z.array(provenanceIdSchema).min(1),
    /** Attribution for the claim, e.g. "QILT GOS 2023". */
    sourceLabel: z.string().min(1).optional(),
    /** Year the source data refers to. */
    year: z.number().int().gte(1900).lte(2100).optional(),
    flagged: z.boolean(),
    flagReason: z.string().min(1).optional(),
    /** Set at gate-1 review when the operator excludes the fact. */
    excluded: z.boolean().optional(),
  })
  .strict();

export const entitySchema = z
  .object({
    type: z.literal("entity"),
    kind: entityKindSchema,
    value: z.string().min(1),
    /** Canonical form, e.g. ISO date or numeric amount. */
    normalized: z.string().min(1).optional(),
    provenance: z.array(provenanceIdSchema).min(1),
  })
  .strict();

export const quoteSchema = z
  .object({
    type: z.literal("quote"),
    text: z.string().min(1),
    attribution: z.string().min(1).optional(),
    provenance: z.array(provenanceIdSchema).min(1),
  })
  .strict();

export const inventoryItemSchema = z.discriminatedUnion("type", [
  conceptSchema,
  factSchema,
  entitySchema,
  quoteSchema,
]);

export type ClaimClass = z.infer<typeof claimClassSchema>;
export type EntityKind = z.infer<typeof entityKindSchema>;
export type Concept = z.infer<typeof conceptSchema>;
export type Fact = z.infer<typeof factSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

// --- Flagging floor (enforced in code, never left to the LLM) ---

/**
 * Code-level flagging floor: any statistic missing a sourceLabel or year is
 * born flagged. The LLM may flag with its own reasons (source-conflict,
 * dated-source, …); this floor is additive and never unflags.
 */
export function applyFlagFloor(fact: Fact): Fact {
  if (
    fact.claimClass === "statistic" &&
    (fact.sourceLabel === undefined || fact.year === undefined)
  ) {
    return {
      ...fact,
      flagged: true,
      // Keep a more specific LLM-provided reason if the LLM already flagged.
      flagReason: fact.flagged
        ? (fact.flagReason ?? FLAG_REASON_MISSING_SOURCE_OR_YEAR)
        : FLAG_REASON_MISSING_SOURCE_OR_YEAR,
    };
  }
  return fact;
}

// --- Concept title normalization (merge pre-grouping + eval matching) ---

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeConceptTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- LLM wire schemas (structured outputs) ---
//
// Strict JSON-schema structured outputs require every property to be present,
// so optional fields are expressed as `nullable` on the wire and converted to
// undefined when stored. Provenance is never round-tripped through the model:
// per-page extraction is stamped with the page's provenance ID in code, and
// the merge pass returns member keys from which code unions provenance.

export const llmExtractedConceptSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
});

/**
 * Models routinely emit years as strings ("2023", "2023-24") despite the
 * schema. The wire is lenient — take the first plausible 4-digit year, or
 * null — because a whole page failing over a quoted year is worse than a
 * coerced value (the flag floor still governs statistic sourcing).
 */
const lenientYearSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const match = value.match(/\b(19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
  }
  return value;
}, z.number().int().nullable());

export const llmExtractedFactSchema = z.object({
  conceptKey: z.string().min(1),
  statement: z.string().min(1),
  claimClass: claimClassSchema,
  sourceLabel: z.string().nullable(),
  year: lenientYearSchema,
  flagged: z.boolean(),
  flagReason: z.string().nullable(),
});

export const llmExtractedEntitySchema = z.object({
  kind: entityKindSchema,
  value: z.string().min(1),
  normalized: z.string().nullable(),
});

export const llmExtractedQuoteSchema = z.object({
  text: z.string().min(1),
  attribution: z.string().nullable(),
});

/** Output of the extract-page task (one page). */
export const llmPageExtractionSchema = z.object({
  concepts: z.array(llmExtractedConceptSchema),
  facts: z.array(llmExtractedFactSchema),
  entities: z.array(llmExtractedEntitySchema),
  quotes: z.array(llmExtractedQuoteSchema),
});

/** Output of the merge-inventory task: canonical concepts + their members. */
export const llmMergedConceptSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  /** Keys of the per-page concepts merged into this canonical concept. */
  memberKeys: z.array(z.string().min(1)).min(1),
});

export const llmMergeResultSchema = z.object({
  concepts: z.array(llmMergedConceptSchema),
});

/** Output of the infer-theme task (pdf-native docs, candidates only). */
export const llmInferredThemeSchema = z.object({
  colors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)),
  fonts: z.array(z.string().min(1)),
});

export type LlmPageExtraction = z.infer<typeof llmPageExtractionSchema>;
export type LlmMergeResult = z.infer<typeof llmMergeResultSchema>;
export type LlmInferredTheme = z.infer<typeof llmInferredThemeSchema>;

// --- Golden label files (eval harness) ---

export const labelledConceptSchema = z
  .object({
    key: z.string().min(1),
    title: z.string().min(1),
    /**
     * Alternate titles that also count as this concept (the same topic is
     * often legitimately titled differently between extraction runs).
     */
    aliases: z.array(z.string().min(1)).optional(),
    /** 1-based page numbers the concept comes from. */
    pages: z.array(z.number().int().positive()).min(1),
  })
  .strict();

export const knownDirtyStatisticSchema = z
  .object({
    id: z.string().min(1),
    /** Human description of the unsourced/conflicting statistic. */
    description: z.string().min(1),
    pages: z.array(z.number().int().positive()).min(1),
    /**
     * Keywords that must ALL appear (case-insensitive) in a flagged fact's
     * statement for it to count as this statistic being flagged.
     */
    match: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const mustExtractEntitySchema = z
  .object({
    kind: entityKindSchema,
    /** Case-insensitive substring expected in an extracted entity value. */
    value: z.string().min(1),
  })
  .strict();

export const labelsFileSchema = z
  .object({
    /** Fixture basename, e.g. "doc-a". */
    doc: z.string().min(1),
    /** Operator sign-off; eval warns when false. */
    confirmed: z.boolean(),
    concepts: z.array(labelledConceptSchema).min(1),
    knownDirtyStatistics: z.array(knownDirtyStatisticSchema),
    mustExtractEntities: z.array(mustExtractEntitySchema),
  })
  .strict();

export type LabelledConcept = z.infer<typeof labelledConceptSchema>;
export type KnownDirtyStatistic = z.infer<typeof knownDirtyStatisticSchema>;
export type LabelsFile = z.infer<typeof labelsFileSchema>;
