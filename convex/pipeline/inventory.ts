import { v } from "convex/values";
import {
  inventoryItemSchema,
  type InventoryItem,
} from "@counseliq/course-schema";
import {
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { AppErrorCode, appError } from "../errors";
import { requireAdmin } from "../admin";

/**
 * Data layer for the extraction pipeline: extraction plan, per-page result
 * cache, and the run's knowledge inventory. All LLM/network work lives in
 * the Node actions (extract.ts); everything here is plain Convex runtime.
 */

/** Everything the extraction orchestrator needs to fan out page calls. */
export const getExtractionPlan = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("sourceDocs")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(100);
    const pages: Array<{
      sourceDocId: Id<"sourceDocs">;
      n: number;
      pngKey: string;
      thumbKey?: string;
      text: string;
      notes: string;
      hash: string;
      provenanceId: string;
      docKind: string;
      docShape?: string;
    }> = [];
    for (const doc of docs) {
      const slides = await ctx.db
        .query("slides")
        .withIndex("by_source_doc_and_n", (q) => q.eq("sourceDocId", doc._id))
        .take(500);
      for (const slide of slides) {
        pages.push({
          sourceDocId: doc._id,
          n: slide.n,
          pngKey: slide.pngKey,
          ...(slide.thumbKey !== undefined ? { thumbKey: slide.thumbKey } : {}),
          text: slide.text,
          notes: slide.notes,
          hash: slide.hash,
          provenanceId: slide.provenanceId ?? `doc:${doc._id}:page:${slide.n}`,
          docKind: doc.kind,
          ...(doc.shape !== undefined ? { docShape: doc.shape } : {}),
        });
      }
    }
    return {
      docs: docs.map((doc) => ({
        _id: doc._id,
        kind: doc.kind,
        theme: doc.theme ?? null,
        pageCount: doc.pageCount ?? 0,
      })),
      pages,
    };
  },
});

/** One page's slide + doc context for a single extraction call. */
export const getPageForExtraction = internalQuery({
  args: { sourceDocId: v.id("sourceDocs"), n: v.number() },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.sourceDocId);
    if (!doc) appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);
    const slide = await ctx.db
      .query("slides")
      .withIndex("by_source_doc_and_n", (q) =>
        q.eq("sourceDocId", args.sourceDocId).eq("n", args.n)
      )
      .unique();
    if (!slide) appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);
    return {
      pngKey: slide.pngKey,
      text: slide.text,
      notes: slide.notes,
      hash: slide.hash,
      provenanceId:
        slide.provenanceId ?? `doc:${args.sourceDocId}:page:${slide.n}`,
      docKind: doc.kind,
      docShape: doc.shape ?? null,
      pageCount: doc.pageCount ?? 0,
    };
  },
});

/** Cached extraction result for one page, or null when stale/absent. */
export const getPageExtraction = internalQuery({
  args: {
    sourceDocId: v.id("sourceDocs"),
    n: v.number(),
    cacheKey: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pageExtractions")
      .withIndex("by_source_doc_and_n", (q) =>
        q.eq("sourceDocId", args.sourceDocId).eq("n", args.n)
      )
      .unique();
    if (row && row.cacheKey === args.cacheKey) return row.result;
    // Content-addressed fallback: the same page bytes were extracted under
    // a different sourceDoc row (documents are re-registered per run).
    // The caller re-stamps provenance onto THIS page and saves a copy.
    const byContent = await ctx.db
      .query("pageExtractions")
      .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();
    return byContent?.result ?? null;
  },
});

/** Upserts the extraction result for one page (idempotent re-runs replace). */
export const savePageExtraction = internalMutation({
  args: {
    sourceDocId: v.id("sourceDocs"),
    n: v.number(),
    cacheKey: v.string(),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pageExtractions")
      .withIndex("by_source_doc_and_n", (q) =>
        q.eq("sourceDocId", args.sourceDocId).eq("n", args.n)
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        cacheKey: args.cacheKey,
        result: args.result,
      });
    } else {
      await ctx.db.insert("pageExtractions", args);
    }
    return null;
  },
});

/** All cached page extractions for the docs of a run. */
export const listPageExtractionsForRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("sourceDocs")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(100);
    const rows: Doc<"pageExtractions">[] = [];
    for (const doc of docs) {
      const docRows = await ctx.db
        .query("pageExtractions")
        .withIndex("by_source_doc_and_n", (q) =>
          q.eq("sourceDocId", doc._id)
        )
        .take(500);
      rows.push(...docRows);
    }
    return rows;
  },
});

/**
 * Replaces the run's inventory atomically: validates every item against the
 * shared Zod contract, deletes the previous inventory, inserts the new one.
 * Re-extraction therefore replaces rather than duplicates.
 */
export const replaceInventory = internalMutation({
  args: {
    runId: v.id("runs"),
    items: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const items: InventoryItem[] = args.items.map((raw) => {
      const parsed = inventoryItemSchema.safeParse(raw);
      if (!parsed.success) {
        console.error(
          `[pipeline] replaceInventory: invalid item for run ${args.runId}: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`
        );
        appError(AppErrorCode.RUN_TRANSITION_INVALID);
      }
      return parsed.data;
    });

    const existing = await ctx.db
      .query("inventoryItems")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(5000);
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    let flaggedFacts = 0;
    for (const item of items) {
      const provenance =
        item.type === "concept" ? item.pageProvenance : item.provenance;
      const flagged = item.type === "fact" ? item.flagged : false;
      if (flagged) flaggedFacts += 1;
      await ctx.db.insert("inventoryItems", {
        runId: args.runId,
        kind: item.type,
        body: item,
        ...(item.type === "fact" ? { claimClass: item.claimClass } : {}),
        provenance,
        flagged,
        ...(item.type === "fact" && item.flagReason !== undefined
          ? { flagReason: item.flagReason }
          : {}),
      });
    }

    return {
      total: items.length,
      concepts: items.filter((i) => i.type === "concept").length,
      facts: items.filter((i) => i.type === "fact").length,
      entities: items.filter((i) => i.type === "entity").length,
      quotes: items.filter((i) => i.type === "quote").length,
      flaggedFacts,
    };
  },
});

/** Records the prompt versions + routed models a run used (reproducibility). */
export const setRunPromptVersions = internalMutation({
  args: {
    runId: v.id("runs"),
    promptVersions: v.any(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    await ctx.db.patch(args.runId, { promptVersions: args.promptVersions });
    return null;
  },
});

/** Stores an LLM-inferred candidate theme on a pdf-native source doc. */
export const setDocInferredTheme = internalMutation({
  args: {
    sourceDocId: v.id("sourceDocs"),
    colors: v.array(v.string()),
    fonts: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.sourceDocId);
    if (!doc) appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);
    // ooxml extraction remains authoritative when present. A pdf converter
    // manifest may have parked logoCandidates in an otherwise-empty
    // llm-inferred theme (M6 pdfimages extraction) — merge colors/fonts in
    // while PRESERVING those candidates; never overwrite colors that are
    // already there.
    if (doc.theme?.method === "ooxml") return null;
    if ((doc.theme?.colors?.length ?? 0) > 0) return null;
    await ctx.db.patch(args.sourceDocId, {
      theme: {
        method: "llm-inferred",
        colors: args.colors,
        fonts: args.fonts,
        logoCandidates: doc.theme?.logoCandidates ?? [],
      },
    });
    return null;
  },
});

/** Full inventory for a run (walkthrough, eval). */
export const listInventoryForRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("inventoryItems")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(5000);
  },
});

/** Admin inventory browser: all items for a run, with counts. */
export const getRunInventory = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const items = await ctx.db
      .query("inventoryItems")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(5000);
    return {
      items,
      counts: {
        concepts: items.filter((i) => i.kind === "concept").length,
        facts: items.filter((i) => i.kind === "fact").length,
        entities: items.filter((i) => i.kind === "entity").length,
        quotes: items.filter((i) => i.kind === "quote").length,
        flagged: items.filter((i) => i.flagged).length,
      },
    };
  },
});
