/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { materializeReviewedInventory } from "./pipeline/inventory";

const modules = import.meta.glob("./**/*.ts");

async function setupRun(state: "UPLOADED" | "GATE_2_COURSE_REVIEW") {
  const t = convexTest(schema, modules);
  const { institutionId, runId } = await t.run(async (ctx) => {
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
    return { institutionId, runId };
  });
  return { t, institutionId, runId: runId as Id<"runs"> };
}

describe("transitionRun", () => {
  test("legal transition updates state and writes a runEvent", async () => {
    const { t, runId } = await setupRun("UPLOADED");

    await t.mutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "CONVERTING",
      actor: "test",
      detail: "test transition",
    });

    const { run, events } = await t.query(
      internal.pipeline.queries.getRunInternal,
      { runId }
    );

    expect(run?.state).toBe("CONVERTING");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      runId,
      fromState: "UPLOADED",
      toState: "CONVERTING",
      actor: "test",
      detail: "test transition",
    });
  });

  test("illegal transition (UPLOADED -> PUBLISHED) throws and writes nothing", async () => {
    const { t, runId } = await setupRun("UPLOADED");

    await expect(
      t.mutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "PUBLISHED",
        actor: "test",
      })
    ).rejects.toThrow(/RUN_TRANSITION_INVALID/);

    const { run, events } = await t.query(
      internal.pipeline.queries.getRunInternal,
      { runId }
    );
    expect(run?.state).toBe("UPLOADED");
    expect(events).toHaveLength(0);
  });

  test("skipping conversion (UPLOADED -> EXTRACTING) is illegal in M2", async () => {
    const { t, runId } = await setupRun("UPLOADED");

    await expect(
      t.mutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "EXTRACTING",
        actor: "test",
      })
    ).rejects.toThrow(/RUN_TRANSITION_INVALID/);
  });

  test("any state may fail, but FAILED is terminal", async () => {
    const { t, runId } = await setupRun("UPLOADED");

    await t.mutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "FAILED",
      actor: "test",
      error: { retryable: true, cause: "test failure" },
    });

    const { run } = await t.query(internal.pipeline.queries.getRunInternal, {
      runId,
    });
    expect(run?.state).toBe("FAILED");
    expect(run?.error).toEqual({ retryable: true, cause: "test failure" });

    await expect(
      t.mutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "FAILED",
        actor: "test",
      })
    ).rejects.toThrow(/RUN_TRANSITION_INVALID/);
  });
});

describe("decideGate", () => {
  test("refuses when the run is not at the requested gate", async () => {
    const { t, runId } = await setupRun("UPLOADED");

    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 2,
        decision: "approve",
      })
    ).rejects.toThrow(/RUN_NOT_AT_GATE/);

    const { run } = await t.query(internal.pipeline.queries.getRunInternal, {
      runId,
    });
    expect(run?.state).toBe("UPLOADED");
  });

  test("reject at gate 2 fails the run with a retryable error", async () => {
    const { t, runId } = await setupRun("GATE_2_COURSE_REVIEW");

    await t.mutation(internal.pipeline.runs.decideGate, {
      runId,
      gate: 2,
      decision: "reject",
      reviewer: "test-reviewer",
    });

    const { run, events } = await t.query(
      internal.pipeline.queries.getRunInternal,
      { runId }
    );
    expect(run?.state).toBe("FAILED");
    expect(run?.error).toEqual({ retryable: true, cause: "gate 2 rejected" });
    expect(events.at(-1)).toMatchObject({
      fromState: "GATE_2_COURSE_REVIEW",
      toState: "FAILED",
      actor: "test-reviewer",
    });
  });
});

describe("startRun source-doc readiness", () => {
  test("rejects source docs with pending fact review", async () => {
    const t = convexTest(schema, modules);
    const { institutionId, sourceDocId } = await t.run(async (ctx) => {
      const institutionId = await ctx.db.insert("institutions", {
        name: "Doc Review University",
        brandTokens: {},
        pronunciationLexicon: {},
        market: "AU",
      });
      const sourceDocId = await ctx.db.insert("sourceDocs", {
        institutionId,
        kind: "pdf",
        objectKey: `sha256/${"d".repeat(64)}.pdf`,
        status: "converted",
        pageCount: 1,
      });
      await ctx.db.insert("slides", {
        sourceDocId,
        n: 1,
        pngKey: `sha256/${"e".repeat(64)}.png`,
        thumbKey: `sha256/${"f".repeat(64)}.png`,
        text: "facts",
        notes: "",
        hash: "e".repeat(64),
        provenanceId: `doc:${sourceDocId}:page:1`,
        embeddedImages: [],
      });
      await ctx.db.insert("pageExtractions", {
        sourceDocId,
        n: 1,
        cacheKey: "hash:extract-page@1:model",
        result: {
          provenanceId: `doc:${sourceDocId}:page:1`,
          concepts: [],
          facts: [
            {
              type: "fact",
              conceptKey: "employment",
              statement: "87% employment",
              claimClass: "statistic",
              provenance: [`doc:${sourceDocId}:page:1`],
              flagged: true,
              flagReason: "missing-source-or-year",
            },
          ],
          entities: [],
          quotes: [],
        },
      });
      return { institutionId, sourceDocId };
    });

    await expect(
      t.mutation(internal.pipeline.runs.startRun, {
        institutionId,
        sourceDocIds: [sourceDocId],
      })
    ).rejects.toThrow(/SOURCE_DOC_FACTS_PENDING_REVIEW/);
  });

  test("requires at least one previously uploaded source document", async () => {
    const t = convexTest(schema, modules);
    const institutionId = await t.run(async (ctx) => {
      return await ctx.db.insert("institutions", {
        name: "No Docs University",
        brandTokens: {},
        pronunciationLexicon: {},
        market: "AU",
      });
    });

    await expect(
      t.mutation(internal.pipeline.runs.startRun, {
        institutionId,
        sourceDocIds: [],
      })
    ).rejects.toThrow(/SOURCE_DOCS_REQUIRED/);
  });

  test("rejects converted documents with no extracted pages", async () => {
    const t = convexTest(schema, modules);
    const { institutionId, sourceDocId } = await t.run(async (ctx) => {
      const institutionId = await ctx.db.insert("institutions", {
        name: "Empty Doc University",
        brandTokens: {},
        pronunciationLexicon: {},
        market: "AU",
      });
      const sourceDocId = await ctx.db.insert("sourceDocs", {
        institutionId,
        kind: "pdf",
        objectKey: `sha256/${"0".repeat(64)}.pdf`,
        status: "converted",
        pageCount: 0,
      });
      return { institutionId, sourceDocId };
    });

    await expect(
      t.mutation(internal.pipeline.runs.startRun, {
        institutionId,
        sourceDocIds: [sourceDocId],
      })
    ).rejects.toThrow(/SOURCE_DOC_FACTS_PENDING_REVIEW/);
  });

  test("approved source-doc facts materialize without re-extraction", async () => {
    const t = convexTest(schema, modules);
    const { institutionId, sourceDocId } = await t.run(async (ctx) => {
      const institutionId = await ctx.db.insert("institutions", {
        name: "Doc Ready University",
        brandTokens: {},
        pronunciationLexicon: {},
        market: "AU",
      });
      const sourceDocId = await ctx.db.insert("sourceDocs", {
        institutionId,
        kind: "pdf",
        objectKey: `sha256/${"a".repeat(64)}.pdf`,
        status: "converted",
        pageCount: 1,
      });
      await ctx.db.insert("slides", {
        sourceDocId,
        n: 1,
        pngKey: `sha256/${"b".repeat(64)}.png`,
        thumbKey: `sha256/${"c".repeat(64)}.png`,
        text: "facts",
        notes: "",
        hash: "b".repeat(64),
        provenanceId: `doc:${sourceDocId}:page:1`,
        embeddedImages: [],
      });
      await ctx.db.insert("pageExtractions", {
        sourceDocId,
        n: 1,
        cacheKey: "hash:extract-page@1:model",
        result: {
          provenanceId: `doc:${sourceDocId}:page:1`,
          concepts: [
            {
              key: "employment",
              title: "Employment",
              summary: "Graduate outcomes",
            },
          ],
          facts: [
            {
              type: "fact",
              conceptKey: "employment",
              statement: "87% employment",
              claimClass: "statistic",
              provenance: [`doc:${sourceDocId}:page:1`],
              flagged: false,
            },
          ],
          entities: [],
          quotes: [],
        },
      });
      return { institutionId, sourceDocId };
    });

    await expect(
      t.mutation(internal.pipeline.runs.startRun, {
        institutionId,
        sourceDocIds: [sourceDocId],
      })
    ).rejects.toThrow(/Component "workflow" is not registered/);

    const snapshot = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("runs", {
        institutionId,
        state: "OUTLINING",
        promptVersions: {},
      });
      await ctx.db.patch(sourceDocId, { runId });
      await materializeReviewedInventory(ctx, runId, [sourceDocId]);
      const inventory = await ctx.db
        .query("inventoryItems")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .take(10);
      const extraction = await ctx.db
        .query("pageExtractions")
        .withIndex("by_source_doc_and_n", (q) =>
          q.eq("sourceDocId", sourceDocId).eq("n", 1)
        )
        .unique();
      return { run: await ctx.db.get(runId), inventory, extraction };
    });

    expect(snapshot.run?.state).toBe("OUTLINING");
    expect(snapshot?.inventory).toHaveLength(2);
    expect(snapshot?.inventory.find((item) => item.kind === "fact")?.body).toMatchObject({
      statement: "87% employment",
      flagged: false,
    });
    expect(snapshot?.extraction?.result.facts[0]).toMatchObject({
      statement: "87% employment",
      flagged: false,
    });
  });
});
