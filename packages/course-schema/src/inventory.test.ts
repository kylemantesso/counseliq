import { describe, expect, it } from "vitest";
import {
  FLAG_REASON_MISSING_SOURCE_OR_YEAR,
  applyFlagFloor,
  inventoryItemSchema,
  labelsFileSchema,
  llmPageExtractionSchema,
  normalizeConceptTitle,
  provenanceIdSchema,
  type Fact,
} from "./inventory";

const PROV = "doc:ks7abc123:page:3";

function statistic(overrides: Partial<Fact> = {}): Fact {
  return {
    type: "fact",
    conceptKey: "employment-outcomes",
    statement: "87% of graduates are employed within 4 months",
    claimClass: "statistic",
    provenance: [PROV],
    flagged: false,
    ...overrides,
  };
}

describe("provenanceIdSchema", () => {
  it("accepts doc:{id}:page:{n}", () => {
    expect(provenanceIdSchema.safeParse(PROV).success).toBe(true);
  });

  it.each([
    ["missing page", "doc:ks7abc123"],
    ["zero page", "doc:ks7abc123:page:0"],
    ["bare id", "ks7abc123"],
  ])("rejects %s", (_label, value) => {
    expect(provenanceIdSchema.safeParse(value).success).toBe(false);
  });
});

describe("applyFlagFloor", () => {
  it("flags a statistic missing both sourceLabel and year", () => {
    const result = applyFlagFloor(statistic());
    expect(result.flagged).toBe(true);
    expect(result.flagReason).toBe(FLAG_REASON_MISSING_SOURCE_OR_YEAR);
  });

  it("flags a statistic with sourceLabel but no year", () => {
    const result = applyFlagFloor(statistic({ sourceLabel: "QILT GOS" }));
    expect(result.flagged).toBe(true);
  });

  it("flags a statistic with year but no sourceLabel", () => {
    const result = applyFlagFloor(statistic({ year: 2023 }));
    expect(result.flagged).toBe(true);
  });

  it("leaves a fully-sourced statistic unflagged", () => {
    const result = applyFlagFloor(
      statistic({ sourceLabel: "QILT GOS 2023", year: 2023 })
    );
    expect(result.flagged).toBe(false);
    expect(result.flagReason).toBeUndefined();
  });

  it("never unflags an LLM-flagged fact (keeps its reason)", () => {
    const result = applyFlagFloor(
      statistic({
        sourceLabel: "QILT GOS",
        flagged: true,
        flagReason: "source-conflict",
      })
    );
    expect(result.flagged).toBe(true);
    expect(result.flagReason).toBe("source-conflict");
  });

  it("keeps the LLM reason when floor also applies to a flagged fact", () => {
    const result = applyFlagFloor(
      statistic({ flagged: true, flagReason: "dated-source" })
    );
    expect(result.flagged).toBe(true);
    expect(result.flagReason).toBe("dated-source");
  });

  it("does not touch non-statistic claims", () => {
    const result = applyFlagFloor(
      statistic({ claimClass: "institution_claim" })
    );
    expect(result.flagged).toBe(false);
  });
});

describe("inventoryItemSchema", () => {
  it("accepts each variant of the union", () => {
    const items = [
      {
        type: "concept",
        key: "graduate-outcomes",
        title: "Graduate outcomes",
        summary: "Employment and salary results",
        pageProvenance: [PROV],
      },
      statistic({ flagged: true, flagReason: "missing-source-or-year" }),
      {
        type: "entity",
        kind: "campus",
        value: "Bundoora",
        provenance: [PROV],
      },
      {
        type: "quote",
        text: "A quote from the deck",
        attribution: "Vice-Chancellor",
        provenance: [PROV],
      },
    ];
    for (const item of items) {
      expect(inventoryItemSchema.safeParse(item).success).toBe(true);
    }
  });

  it("rejects a fact with invalid provenance", () => {
    const result = inventoryItemSchema.safeParse(
      statistic({ provenance: ["page-3"] })
    );
    expect(result.success).toBe(false);
  });

  it("rejects unknown claim classes", () => {
    const result = inventoryItemSchema.safeParse(
      statistic({ claimClass: "opinion" as never })
    );
    expect(result.success).toBe(false);
  });
});

describe("llmPageExtractionSchema", () => {
  it("accepts nullable optional fields on the wire", () => {
    const result = llmPageExtractionSchema.safeParse({
      concepts: [{ key: "k", title: "T", summary: "" }],
      facts: [
        {
          conceptKey: "k",
          statement: "s",
          claimClass: "statistic",
          sourceLabel: null,
          year: null,
          flagged: false,
          flagReason: null,
        },
      ],
      entities: [{ kind: "date", value: "2024", normalized: null }],
      quotes: [{ text: "q", attribution: null }],
    });
    expect(result.success).toBe(true);
  });

  it("coerces string years on the wire instead of failing the page", () => {
    const fact = {
      conceptKey: "k",
      statement: "s",
      claimClass: "statistic",
      sourceLabel: "QILT GOS",
      flagged: false,
      flagReason: null,
    };
    const parse = (year: unknown) =>
      llmPageExtractionSchema.safeParse({
        concepts: [],
        facts: [{ ...fact, year }],
        entities: [],
        quotes: [],
      });

    const numeric = parse("2023");
    expect(numeric.success).toBe(true);
    if (numeric.success) expect(numeric.data.facts[0].year).toBe(2023);

    const range = parse("2023-24");
    expect(range.success).toBe(true);
    if (range.success) expect(range.data.facts[0].year).toBe(2023);

    const junk = parse("recent");
    expect(junk.success).toBe(true);
    if (junk.success) expect(junk.data.facts[0].year).toBeNull();
  });
});

describe("normalizeConceptTitle", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeConceptTitle("  Graduate‑Outcomes:  (QILT)! ")).toBe(
      "graduate outcomes qilt"
    );
  });
});

describe("labelsFileSchema", () => {
  it("accepts a valid labels file", () => {
    const result = labelsFileSchema.safeParse({
      doc: "doc-a",
      confirmed: false,
      concepts: [{ key: "k", title: "T", pages: [1, 2] }],
      knownDirtyStatistics: [
        {
          id: "employment-rate",
          description: "87% employment claim with no source",
          pages: [4],
          match: ["87%", "employ"],
        },
      ],
      mustExtractEntities: [{ kind: "org", value: "La Trobe" }],
    });
    expect(result.success).toBe(true);
  });
});
