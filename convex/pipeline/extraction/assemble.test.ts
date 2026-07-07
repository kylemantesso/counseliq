// @vitest-environment node
import { describe, expect, test } from "vitest";
import type { LlmPageExtraction } from "@counseliq/course-schema";
import {
  assembleInventory,
  preGroupConcepts,
  storePageExtraction,
} from "./assemble";

const PROV_A1 = "doc:docAAA111:page:1";
const PROV_A2 = "doc:docAAA111:page:2";
const PROV_B1 = "doc:docBBB222:page:1";

function wirePage(overrides: Partial<LlmPageExtraction> = {}): LlmPageExtraction {
  return {
    concepts: [],
    facts: [],
    entities: [],
    quotes: [],
    ...overrides,
  };
}

describe("storePageExtraction", () => {
  test("stamps provenance and applies the flag floor to unsourced statistics", () => {
    const stored = storePageExtraction(
      PROV_A1,
      wirePage({
        concepts: [{ key: "outcomes", title: "Outcomes", summary: "s" }],
        facts: [
          {
            conceptKey: "outcomes",
            statement: "87% of graduates are employed",
            claimClass: "statistic",
            sourceLabel: null,
            year: null,
            flagged: false,
            flagReason: null,
          },
          {
            conceptKey: "outcomes",
            statement: "92% satisfaction",
            claimClass: "statistic",
            sourceLabel: "QILT GOS",
            year: 2024,
            flagged: false,
            flagReason: null,
          },
        ],
        entities: [{ kind: "org", value: "La Trobe", normalized: null }],
        quotes: [{ text: "Great place", attribution: null }],
      })
    );

    expect(stored.facts[0].flagged).toBe(true);
    expect(stored.facts[0].flagReason).toBe("missing-source-or-year");
    expect(stored.facts[0].provenance).toEqual([PROV_A1]);
    expect(stored.facts[1].flagged).toBe(false);
    expect(stored.facts[1].sourceLabel).toBe("QILT GOS");
    expect(stored.entities[0].provenance).toEqual([PROV_A1]);
    expect(stored.entities[0].normalized).toBeUndefined();
    expect(stored.quotes[0].provenance).toEqual([PROV_A1]);
  });

  test("preserves an LLM-supplied flag reason (floor never downgrades)", () => {
    const stored = storePageExtraction(
      PROV_A1,
      wirePage({
        facts: [
          {
            conceptKey: "k",
            statement: "conflicting numbers on this page",
            claimClass: "statistic",
            sourceLabel: "Source X",
            year: 2020,
            flagged: true,
            flagReason: "source-conflict",
          },
        ],
      })
    );
    expect(stored.facts[0].flagged).toBe(true);
    expect(stored.facts[0].flagReason).toBe("source-conflict");
  });
});

describe("preGroupConcepts", () => {
  test("groups candidates with the same normalized title across pages/docs", () => {
    const pages = [
      storePageExtraction(
        PROV_A1,
        wirePage({
          concepts: [
            { key: "grad-employment", title: "Graduate Employment!", summary: "a" },
          ],
        })
      ),
      storePageExtraction(
        PROV_B1,
        wirePage({
          concepts: [
            { key: "graduate-employment", title: "graduate employment", summary: "b" },
            { key: "campuses", title: "Campuses", summary: "c" },
          ],
        })
      ),
    ];
    const groups = preGroupConcepts(pages);
    expect(groups).toHaveLength(2);
    const employment = groups.find((g) => g.members.length === 2);
    expect(employment).toBeDefined();
    expect(employment?.members.map((m) => m.provenanceId).sort()).toEqual([
      PROV_A1,
      PROV_B1,
    ]);
  });
});

describe("assembleInventory", () => {
  const pages = [
    storePageExtraction(
      PROV_A1,
      wirePage({
        concepts: [{ key: "emp", title: "Employment outcomes", summary: "a" }],
        facts: [
          {
            conceptKey: "emp",
            statement: "87% employed within 4 months",
            claimClass: "statistic",
            sourceLabel: null,
            year: null,
            flagged: false,
            flagReason: null,
          },
        ],
      })
    ),
    storePageExtraction(
      PROV_A2,
      wirePage({
        entities: [{ kind: "campus", value: "Bundoora", normalized: null }],
      })
    ),
    storePageExtraction(
      PROV_B1,
      wirePage({
        concepts: [{ key: "grad-emp", title: "Graduate employment", summary: "b" }],
        facts: [
          {
            conceptKey: "grad-emp",
            statement: "87% employed within 4 months",
            claimClass: "statistic",
            sourceLabel: null,
            year: null,
            flagged: false,
            flagReason: null,
          },
        ],
        entities: [{ kind: "campus", value: "bundoora", normalized: "Bundoora" }],
      })
    ),
  ];

  test("merge preserves provenance from multiple docs in ONE inventory", () => {
    const groups = preGroupConcepts(pages);
    expect(groups).toHaveLength(2); // different normalized titles

    // The merge LLM says both groups are the same concept.
    const items = assembleInventory(pages, groups, {
      concepts: [
        {
          key: "graduate-employment",
          title: "Graduate employment",
          summary: "merged",
          memberKeys: groups.map((g) => g.key),
        },
      ],
    });

    const concepts = items.filter((i) => i.type === "concept");
    expect(concepts).toHaveLength(1);
    expect(concepts[0].key).toBe("graduate-employment");
    expect(concepts[0].pageProvenance).toEqual([PROV_B1, PROV_A1].sort());

    // Identical facts from both docs dedupe, unioning provenance, and the
    // fact is re-attached to the canonical concept key.
    const facts = items.filter((i) => i.type === "fact");
    expect(facts).toHaveLength(1);
    expect(facts[0].conceptKey).toBe("graduate-employment");
    expect(facts[0].provenance).toEqual([PROV_B1, PROV_A1].sort());
    expect(facts[0].flagged).toBe(true); // floor survives the merge

    // Entities dedupe case-insensitively with unioned provenance.
    const entities = items.filter((i) => i.type === "entity");
    expect(entities).toHaveLength(1);
    expect(entities[0].provenance).toEqual([PROV_A2, PROV_B1].sort());
    expect(entities[0].normalized).toBe("Bundoora");
  });

  test("groups the merge result does not claim survive as their own concepts", () => {
    const groups = preGroupConcepts(pages);
    const items = assembleInventory(pages, groups, {
      concepts: [
        {
          key: "only-one",
          title: "Employment outcomes",
          summary: "s",
          // References only the first group + a hallucinated key.
          memberKeys: [groups[0].key, "g999"],
        },
      ],
    });
    const concepts = items.filter((i) => i.type === "concept");
    expect(concepts).toHaveLength(2); // claimed + surviving unclaimed group
  });

  test("null merge result performs an identity merge (nothing dropped)", () => {
    const groups = preGroupConcepts(pages);
    const items = assembleInventory(pages, groups, null);
    expect(items.filter((i) => i.type === "concept")).toHaveLength(2);
    expect(items.filter((i) => i.type === "fact")).toHaveLength(2);
  });

  test("all assembled items satisfy the shared inventory contract", async () => {
    const { inventoryItemSchema } = await import("@counseliq/course-schema");
    const groups = preGroupConcepts(pages);
    const items = assembleInventory(pages, groups, null);
    for (const item of items) {
      expect(inventoryItemSchema.safeParse(item).success).toBe(true);
    }
  });
});
