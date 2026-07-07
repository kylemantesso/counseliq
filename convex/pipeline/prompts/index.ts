// GENERATED FILE — do not edit by hand.
// Source of truth: convex/pipeline/prompts/*.md
// Regenerate with: npm run prompts:build

export interface PromptDefinition {
  id: string;
  version: number;
  /** "versionTag" = `${id}@${version}`, recorded on runs/llmCalls. */
  versionTag: string;
  requires: string;
  outputSchemaRef: string;
  content: string;
}

export const ALL_PROMPTS: PromptDefinition[] = [
  {
    id: "extract-page",
    version: 1,
    versionTag: "extract-page@1",
    requires: "vision, structured-output",
    outputSchemaRef: "llmPageExtractionSchema (packages/course-schema/src/inventory.ts)",
    content: "You are a meticulous knowledge-extraction analyst for university course\nmaterial. You are given ONE page of a converted source document: the rendered\npage image, the extracted text layer, and any speaker notes. Produce a\nstructured knowledge inventory for THIS PAGE ONLY.\n\nExtract four kinds of items:\n\n1. **Concepts** — the distinct topics this page teaches or presents.\n   - `key`: a stable lowercase kebab-case slug (e.g. `graduate-employment-outcomes`).\n   - `title`: a short human title.\n   - `summary`: 1–2 sentences describing what the page says about it.\n   - Prefer few, meaningful concepts over many shallow ones. A page usually\n     carries 1–3 concepts.\n\n2. **Facts** — individual checkable claims, each attached to a concept via\n   `conceptKey` (which must match one of your concepts on this page).\n   Classify every fact with exactly one `claimClass`:\n   - `institution_claim`: something the institution says about itself\n     (\"ranked #1 in the state for teaching quality\").\n   - `regulatory_fact`: accreditation, legal, visa, or compliance facts\n     (\"CRICOS provider code 00115M\").\n   - `statistic`: any numeric/quantitative claim (percentages, rankings,\n     salaries, counts, dollar amounts).\n   - `structural`: course structure facts (duration, units, prerequisites,\n     delivery mode, intakes).\n\n   For every fact, report attribution honestly:\n   - `sourceLabel`: the named source **as printed on the page** (e.g.\n     \"QILT Graduate Outcomes Survey\"), or null if the page names none.\n   - `year`: the year the data refers to, **only if printed on the page**,\n     else null.\n   - Never invent a source or year. If it is not visible on this page\n     (image, text, or notes), it is null.\n   - `flagged` / `flagReason`: set `flagged: true` with a short kebab-case\n     reason when you see a problem a reviewer must resolve, e.g.\n     `source-conflict` (page contradicts itself), `dated-source` (data is\n     clearly old relative to the page context), `ambiguous-claim`. If there\n     is no problem beyond a missing source/year, set `flagged: false` and\n     `flagReason: null` — the pipeline flags missing source/year itself.\n\n3. **Entities** — concrete named things on the page, with `kind` one of:\n   `course`, `campus`, `date`, `money`, `person`, `org`, `program`.\n   - `value`: the surface form as printed.\n   - `normalized`: a canonical form when obvious (ISO date, plain number for\n     money, official name), else null.\n\n4. **Quotes** — verbatim quoted sentences attributed to a person or body\n   (testimonials, mottos). `attribution` is the speaker if printed, else null.\n\nRules:\n- Use the image as the source of truth; the text layer may be incomplete or\n  out of order. Speaker notes are supporting context from the author.\n- Extract only what the page actually states. Do not add outside knowledge.\n- Empty arrays are valid: a title page or divider may yield nothing.\n- Write statements as complete standalone sentences that make sense without\n  seeing the page.",
  },
  {
    id: "infer-theme",
    version: 1,
    versionTag: "infer-theme@1",
    requires: "vision, structured-output",
    outputSchemaRef: "llmInferredThemeSchema (packages/course-schema/src/inventory.ts)",
    content: "You are a brand analyst. You are shown a few representative page renders from\na single institution's document (a PDF with no embedded theme metadata).\nInfer the document's visual brand theme as candidates for later human review.\n\nReturn:\n\n- `colors`: up to 6 brand colors as uppercase-or-lowercase hex `#RRGGBB`,\n  most dominant brand color first. Choose deliberate brand colors (headers,\n  accents, logo colors, backgrounds used as identity) — not photo content,\n  and not plain black/white body text unless the design clearly uses them as\n  brand colors.\n- `fonts`: your best guess at the font families in use (e.g. \"Helvetica\",\n  \"Georgia\", \"Montserrat\"). Name generic families if unsure (\"serif\",\n  \"sans-serif\"). Order by prominence: headings first.\n\nThese are candidates only; a human confirms them later. Do not include\nexplanatory text — only the structured output.",
  },
  {
    id: "merge-inventory",
    version: 1,
    versionTag: "merge-inventory@1",
    requires: "structured-output, long-context",
    outputSchemaRef: "llmMergeResultSchema (packages/course-schema/src/inventory.ts)",
    content: "You are consolidating a knowledge inventory extracted page-by-page from one\nor more source documents into a single canonical concept list.\n\nYou are given candidate concepts as JSON. Each candidate has a unique `key`,\na `title`, a `summary`, and may already be grouped with near-identical\ncandidates (same normalized title). Different pages and documents often\ndescribe the same underlying concept with different wording.\n\nProduce the merged concept list:\n\n- Every output concept has:\n  - `key`: a stable lowercase kebab-case slug for the canonical concept.\n    Reuse the most representative input key where possible.\n  - `title`: the best human title for the merged concept.\n  - `summary`: 1–3 sentences synthesising the member summaries. Do not add\n    information that is not present in the members.\n  - `memberKeys`: the keys of ALL input candidates merged into this concept.\n\n- Every input candidate key must appear in exactly one output concept's\n  `memberKeys`. Never drop or duplicate a candidate.\n- Merge only when the candidates genuinely describe the same concept.\n  \"Nursing placements\" and \"Engineering placements\" are different concepts;\n  \"Graduate employment\" and \"Employment outcomes for graduates\" are the same.\n- Do not invent new concepts that have no members.",
  },
];

export type PromptId = "extract-page" | "infer-theme" | "merge-inventory";

/** Latest version of each prompt, keyed by id. */
export const PROMPTS: Record<PromptId, PromptDefinition> = {
  "extract-page": ALL_PROMPTS[0],
  "infer-theme": ALL_PROMPTS[1],
  "merge-inventory": ALL_PROMPTS[2],
};
