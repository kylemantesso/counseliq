/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Fact, InventoryItem } from "@counseliq/course-schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup(state: "EXTRACTING" = "EXTRACTING") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "Test University",
      brandTokens: {},
      pronunciationLexicon: {},
      market: "AU",
    });
    const runId = await ctx.db.insert("runs", {
      institutionId,
      state,
      promptVersions: {},
    });
    const sourceDocId = await ctx.db.insert("sourceDocs", {
      institutionId,
      runId,
      kind: "pdf",
      objectKey: `sha256/${"a".repeat(64)}.pdf`,
      status: "converted",
      pageCount: 2,
    });
    await ctx.db.insert("slides", {
      sourceDocId,
      n: 1,
      pngKey: `sha256/${"b".repeat(64)}.png`,
      thumbKey: `sha256/${"c".repeat(64)}.png`,
      text: "page one",
      notes: "",
      hash: "b".repeat(64),
      provenanceId: `doc:${sourceDocId}:page:1`,
    });
    return { institutionId, runId, sourceDocId };
  });
  return { t, ...ids };
}

function fact(
  provenance: string[],
  overrides: Partial<Fact> = {}
): Fact {
  return {
    type: "fact",
    conceptKey: "employment",
    statement: "87% of graduates are employed within 4 months",
    claimClass: "statistic",
    provenance,
    flagged: true,
    flagReason: "missing-source-or-year",
    ...overrides,
  };
}

function concept(provenance: string[]): InventoryItem {
  return {
    type: "concept",
    key: "employment",
    title: "Employment outcomes",
    summary: "s",
    pageProvenance: provenance,
  };
}

describe("replaceInventory", () => {
  test("writes items with flag metadata; re-extraction replaces, not duplicates", async () => {
    const { t, runId, sourceDocId } = await setup("EXTRACTING");
    const prov = [`doc:${sourceDocId}:page:1`];

    const first = await t.mutation(
      internal.pipeline.inventory.replaceInventory,
      { runId, items: [concept(prov), fact(prov)] }
    );
    expect(first).toMatchObject({ total: 2, concepts: 1, facts: 1, flaggedFacts: 1 });

    // Idempotent re-run with an updated inventory: replaced, not appended.
    const second = await t.mutation(
      internal.pipeline.inventory.replaceInventory,
      {
        runId,
        items: [
          concept(prov),
          fact(prov, { sourceLabel: "QILT", year: 2024, flagged: false }),
        ],
      }
    );
    expect(second.flaggedFacts).toBe(0);

    const rows = await t.query(
      internal.pipeline.inventory.listInventoryForRun,
      { runId }
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.flagged)).toHaveLength(0);
  });

  test("rejects items violating the shared contract", async () => {
    const { t, runId } = await setup("EXTRACTING");
    await expect(
      t.mutation(internal.pipeline.inventory.replaceInventory, {
        runId,
        items: [{ type: "fact", statement: "no concept key" }],
      })
    ).rejects.toThrow();
  });
});

describe("source-doc fact bulk approval", () => {
  test("approves safe flagged facts and leaves risky/excluded unchanged", async () => {
    const { t, sourceDocId } = await setup("EXTRACTING");
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        tokenIdentifier: "https://convex.test|admin",
        name: "Admin",
        email: "admin@test.dev",
        createdAt: Date.now(),
        isAdmin: true,
      });
      await ctx.db.insert("pageExtractions", {
        sourceDocId,
        n: 1,
        cacheKey: "bulk-safe-approval",
        result: {
          provenanceId: `doc:${sourceDocId}:page:1`,
          concepts: [],
          facts: [
            {
              statement: "Graduates complete clinical placements in semester two.",
              claimClass: "institution_claim",
              conceptKey: "employment",
              provenance: [`doc:${sourceDocId}:page:1`],
              flagged: true,
              flagReason: "missing-source-or-year",
            },
            {
              statement: "It is Australia's largest provider of online education.",
              claimClass: "institution_claim",
              conceptKey: "employment",
              provenance: [`doc:${sourceDocId}:page:1`],
              flagged: true,
              flagReason: "superlative-without-attribution",
            },
            {
              statement: "Legacy fact kept excluded",
              claimClass: "institution_claim",
              conceptKey: "employment",
              provenance: [`doc:${sourceDocId}:page:1`],
              flagged: true,
              excluded: true,
              flagReason: "operator-excluded",
            },
          ],
          entities: [],
          quotes: [],
        },
      });
    });

    const asAdmin = t.withIdentity({ subject: "admin" });
    const result = await asAdmin.mutation(
      api.pipeline.queries.adminApproveAllSafeSourceDocFacts,
      { sourceDocId }
    );

    expect(result).toEqual({
      approved: 1,
      approvedRisky: 0,
      skippedRisky: 1,
      skippedExcluded: 1,
      alreadyReviewed: 0,
    });

    const rows = await t.query(internal.pipeline.inventory.listPageExtractionsForDoc, {
      sourceDocId,
    });
    const facts = (rows[0]?.result as { facts?: Array<{ flagged?: boolean; excluded?: boolean }> })
      .facts;
    expect(facts?.[0]?.flagged).toBe(false);
    expect(facts?.[1]?.flagged).toBe(true);
    expect(facts?.[2]?.excluded).toBe(true);
    expect(facts?.[2]?.flagged).toBe(true);
  });

  test("approves risky facts when includeRisky is true", async () => {
    const { t, sourceDocId } = await setup("EXTRACTING");
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        tokenIdentifier: "https://convex.test|admin",
        name: "Admin",
        email: "admin@test.dev",
        createdAt: Date.now(),
        isAdmin: true,
      });
      await ctx.db.insert("pageExtractions", {
        sourceDocId,
        n: 1,
        cacheKey: "bulk-all-approval",
        result: {
          provenanceId: `doc:${sourceDocId}:page:1`,
          concepts: [],
          facts: [
            {
              statement: "It is Australia's largest provider of online education.",
              claimClass: "institution_claim",
              conceptKey: "employment",
              provenance: [`doc:${sourceDocId}:page:1`],
              flagged: true,
              flagReason: "superlative-without-attribution",
            },
          ],
          entities: [],
          quotes: [],
        },
      });
    });

    const asAdmin = t.withIdentity({ subject: "admin" });
    const result = await asAdmin.mutation(
      api.pipeline.queries.adminApproveAllSourceDocFacts,
      { sourceDocId, includeRisky: true }
    );

    expect(result).toEqual({
      approved: 1,
      approvedRisky: 1,
      skippedRisky: 0,
      skippedExcluded: 0,
      alreadyReviewed: 0,
    });

    const rows = await t.query(internal.pipeline.inventory.listPageExtractionsForDoc, {
      sourceDocId,
    });
    const facts = (rows[0]?.result as { facts?: Array<{ flagged?: boolean; flagReason?: string }> })
      .facts;
    expect(facts?.[0]?.flagged).toBe(false);
    expect(facts?.[0]?.flagReason).toBeUndefined();
  });
});

describe("page extraction cache", () => {
  test("savePageExtraction upserts by page; stale cache keys miss", async () => {
    const { t, sourceDocId } = await setup("EXTRACTING");

    await t.mutation(internal.pipeline.inventory.savePageExtraction, {
      sourceDocId,
      n: 1,
      cacheKey: "hash1:extract-page@1:model-x",
      result: { concepts: [], facts: [], entities: [], quotes: [] },
    });
    await t.mutation(internal.pipeline.inventory.savePageExtraction, {
      sourceDocId,
      n: 1,
      cacheKey: "hash1:extract-page@2:model-x",
      result: { concepts: [], facts: [], entities: [], quotes: [] },
    });

    // Only one row per page (replace, not duplicate).
    const hitNew = await t.query(
      internal.pipeline.inventory.getPageExtraction,
      { sourceDocId, n: 1, cacheKey: "hash1:extract-page@2:model-x" }
    );
    expect(hitNew).not.toBeNull();
    const missOld = await t.query(
      internal.pipeline.inventory.getPageExtraction,
      { sourceDocId, n: 1, cacheKey: "hash1:extract-page@1:model-x" }
    );
    expect(missOld).toBeNull();
  });
});
