/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Fact, InventoryItem } from "@counseliq/course-schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup(state: "EXTRACTING" | "GATE_1_KNOWLEDGE_REVIEW") {
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
      theme: null,
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

describe("gate-1 review items", () => {
  test("generated 1:1 with flagged facts, with thumbnail payload", async () => {
    const { t, runId, sourceDocId } = await setup("GATE_1_KNOWLEDGE_REVIEW");
    const prov = [`doc:${sourceDocId}:page:1`];

    await t.mutation(internal.pipeline.inventory.replaceInventory, {
      runId,
      items: [
        concept(prov),
        fact(prov),
        fact(prov, { statement: "Ranked #1 in the state", flagged: false }),
        fact(prov, {
          statement: "Salary of $75,000 median",
          flagReason: "source-conflict",
        }),
      ],
    });

    await t.mutation(internal.pipeline.reviewItems.createGateReviewItems, {
      runId,
      gate: 1,
    });

    const items = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 1 }
    );
    expect(items).toHaveLength(2); // one per flagged fact
    for (const item of items) {
      expect(item.kind).toBe("flagged_fact");
      expect(item.status).toBe("pending");
      expect(item.inventoryItemId).toBeDefined();
      const payload = item.payload as { thumbKey?: string; pageN?: number };
      expect(payload.thumbKey).toBe(`sha256/${"c".repeat(64)}.png`);
      expect(payload.pageN).toBe(1);
    }

    // Regenerating replaces (idempotent), not duplicates.
    await t.mutation(internal.pipeline.reviewItems.createGateReviewItems, {
      runId,
      gate: 1,
    });
    const again = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 1 }
    );
    expect(again).toHaveLength(2);
  });

  test("gate 1 cannot be approved with unresolved items", async () => {
    const { t, runId, sourceDocId } = await setup("GATE_1_KNOWLEDGE_REVIEW");
    const prov = [`doc:${sourceDocId}:page:1`];
    await t.mutation(internal.pipeline.inventory.replaceInventory, {
      runId,
      items: [fact(prov)],
    });
    await t.mutation(internal.pipeline.reviewItems.createGateReviewItems, {
      runId,
      gate: 1,
    });

    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 1,
        decision: "approve",
      })
    ).rejects.toThrow(/GATE_ITEMS_UNRESOLVED/);
  });

  test("approve-with-source unflags the fact; gate then approvable", async () => {
    const { t, runId, sourceDocId } = await setup("GATE_1_KNOWLEDGE_REVIEW");
    const prov = [`doc:${sourceDocId}:page:1`];
    await t.mutation(internal.pipeline.inventory.replaceInventory, {
      runId,
      items: [fact(prov)],
    });
    await t.mutation(internal.pipeline.reviewItems.createGateReviewItems, {
      runId,
      gate: 1,
    });
    const [item] = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 1 }
    );

    // Approving without a source is refused.
    await expect(
      t.mutation(internal.pipeline.reviewItems.resolveReviewItem, {
        reviewItemId: item._id,
        resolution: "approve",
      })
    ).rejects.toThrow(/REVIEW_ITEM_SOURCE_REQUIRED/);

    await t.mutation(internal.pipeline.reviewItems.resolveReviewItem, {
      reviewItemId: item._id,
      resolution: "approve",
      sourceLabel: "QILT GOS",
      year: 2024,
      reviewer: "tester",
    });

    const inventory = await t.query(
      internal.pipeline.inventory.listInventoryForRun,
      { runId }
    );
    const updated = inventory[0].body as Fact;
    expect(updated.flagged).toBe(false);
    expect(updated.sourceLabel).toBe("QILT GOS");
    expect(updated.year).toBe(2024);
    expect(updated.flagReason).toBeUndefined();
    expect(inventory[0].flagged).toBe(false);

    // Double resolution is refused.
    await expect(
      t.mutation(internal.pipeline.reviewItems.resolveReviewItem, {
        reviewItemId: item._id,
        resolution: "exclude",
      })
    ).rejects.toThrow(/REVIEW_ITEM_ALREADY_RESOLVED/);

    // With every item resolved, the gate check passes: the mutation proceeds
    // past GATE_ITEMS_UNRESOLVED all the way to starting the next workflow
    // (whose component is not registered in convex-test).
    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 1,
        decision: "approve",
        reviewer: "tester",
      })
    ).rejects.toThrow(/Component "workflow" is not registered/);
  });

  test("approve_without_source clears the flag but invents no attribution", async () => {
    const { t, runId, sourceDocId } = await setup("GATE_1_KNOWLEDGE_REVIEW");
    const prov = [`doc:${sourceDocId}:page:1`];
    await t.mutation(internal.pipeline.inventory.replaceInventory, {
      runId,
      items: [fact(prov)],
    });
    await t.mutation(internal.pipeline.reviewItems.createGateReviewItems, {
      runId,
      gate: 1,
    });
    const [item] = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 1 }
    );

    await t.mutation(internal.pipeline.reviewItems.resolveReviewItem, {
      reviewItemId: item._id,
      resolution: "approve_without_source",
      reviewer: "tester",
    });

    const inventory = await t.query(
      internal.pipeline.inventory.listInventoryForRun,
      { runId }
    );
    const updated = inventory[0].body as Fact;
    expect(updated.flagged).toBe(false);
    expect(updated.sourceLabel).toBeUndefined();
    expect(updated.year).toBeUndefined();
    expect(updated.flagReason).toBeUndefined();
    expect(inventory[0].flagged).toBe(false);
  });

  test("exclude marks the fact excluded (unavailable to the compiler)", async () => {
    const { t, runId, sourceDocId } = await setup("GATE_1_KNOWLEDGE_REVIEW");
    const prov = [`doc:${sourceDocId}:page:1`];
    await t.mutation(internal.pipeline.inventory.replaceInventory, {
      runId,
      items: [fact(prov)],
    });
    await t.mutation(internal.pipeline.reviewItems.createGateReviewItems, {
      runId,
      gate: 1,
    });
    const [item] = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 1 }
    );

    await t.mutation(internal.pipeline.reviewItems.resolveReviewItem, {
      reviewItemId: item._id,
      resolution: "exclude",
      reviewer: "tester",
    });

    const inventory = await t.query(
      internal.pipeline.inventory.listInventoryForRun,
      { runId }
    );
    expect(inventory[0].excluded).toBe(true);
    expect((inventory[0].body as Fact).excluded).toBe(true);
    // Still flagged — excluded, not laundered.
    expect(inventory[0].flagged).toBe(true);

    const [resolved] = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 1 }
    );
    expect(resolved.status).toBe("rejected");
  });

  test("gate 1 with zero flagged facts is approvable immediately", async () => {
    const { t, runId, sourceDocId } = await setup("GATE_1_KNOWLEDGE_REVIEW");
    const prov = [`doc:${sourceDocId}:page:1`];
    await t.mutation(internal.pipeline.inventory.replaceInventory, {
      runId,
      items: [concept(prov)],
    });
    await t.mutation(internal.pipeline.reviewItems.createGateReviewItems, {
      runId,
      gate: 1,
    });
    // No items to resolve: the gate check passes and the mutation proceeds
    // to starting the next workflow (component not registered in tests).
    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 1,
        decision: "approve",
      })
    ).rejects.toThrow(/Component "workflow" is not registered/);
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
