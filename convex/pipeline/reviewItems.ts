import { v } from "convex/values";
import type { Fact } from "@counseliq/course-schema";
import { internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { reviewGateValidator } from "../schema";
import { AppErrorCode, appError } from "../errors";
import { requireAdmin } from "../admin";
import type { ReviewGate } from "./states";

const PLACEHOLDER_ITEMS: Record<
  ReviewGate,
  Array<{ kind: string; payload: unknown }>
> = {
  // Gate 1 items are real as of M3 (generated from flagged facts); this
  // entry is unused but kept for the exhaustive type.
  1: [],
  // Gate 2 (M4): the compiled course itself — with per-unit judge flags on
  // microUnits.qa — is the review surface; no reviewItems rows are needed.
  2: [],
  // Gate 3 (M5): items are real and created by the pipeline stages —
  // blocked_unit rows by GENERATING_SCRIPT and failed_unit rows by
  // GENERATING_ASSETS. Nothing is inserted at gate creation time.
  3: [],
};

/** Parses `doc:{sourceDocId}:page:{n}` back into its parts (null if not a page ID). */
function parseProvenanceId(
  provenanceId: string
): { sourceDocId: string; n: number } | null {
  const match = provenanceId.match(/^doc:([A-Za-z0-9]+):page:([0-9]+)$/);
  if (!match) return null;
  return { sourceDocId: match[1], n: Number(match[2]) };
}

/**
 * Gate 1 (M3, real): one review item per flagged, non-excluded fact in the
 * run's inventory — payload carries the fact, its provenance, and the page
 * thumbnail key for the first provenance page. Idempotent: existing gate-1
 * items for the run are replaced, not duplicated.
 */
async function insertGate1FlaggedFactItems(
  ctx: MutationCtx,
  runId: Id<"runs">
): Promise<number> {
  const existing = await ctx.db
    .query("reviewItems")
    .withIndex("by_run_and_gate", (q) => q.eq("runId", runId).eq("gate", 1))
    .take(1000);
  for (const item of existing) {
    await ctx.db.delete(item._id);
  }

  const flagged = await ctx.db
    .query("inventoryItems")
    .withIndex("by_run_and_flagged", (q) =>
      q.eq("runId", runId).eq("flagged", true)
    )
    .take(1000);

  let inserted = 0;
  for (const row of flagged) {
    if (row.kind !== "fact" || row.excluded === true) continue;
    const fact = row.body as Fact;

    // Page thumbnail for the first provenance page, when resolvable.
    let thumbKey: string | undefined;
    let pageN: number | undefined;
    const parsed = parseProvenanceId(fact.provenance[0] ?? "");
    if (parsed) {
      const sourceDocId = ctx.db.normalizeId("sourceDocs", parsed.sourceDocId);
      if (sourceDocId) {
        const slide = await ctx.db
          .query("slides")
          .withIndex("by_source_doc_and_n", (q) =>
            q.eq("sourceDocId", sourceDocId).eq("n", parsed.n)
          )
          .unique();
        thumbKey = slide?.thumbKey ?? slide?.pngKey;
        pageN = parsed.n;
      }
    }

    await ctx.db.insert("reviewItems", {
      runId,
      gate: 1,
      kind: "flagged_fact",
      payload: {
        fact,
        provenance: fact.provenance,
        ...(thumbKey !== undefined ? { thumbKey } : {}),
        ...(pageN !== undefined ? { pageN } : {}),
      },
      status: "pending",
      inventoryItemId: row._id,
    });
    inserted += 1;
  }
  return inserted;
}

/** Insert review items for a gate: real flagged-fact items for gate 1, placeholders for gates 2/3. */
export async function insertGateReviewItems(
  ctx: MutationCtx,
  runId: Id<"runs">,
  gate: ReviewGate
): Promise<void> {
  if (gate === 1) {
    await insertGate1FlaggedFactItems(ctx, runId);
    return;
  }
  for (const item of PLACEHOLDER_ITEMS[gate]) {
    await ctx.db.insert("reviewItems", {
      runId,
      gate,
      kind: item.kind,
      payload: item.payload,
      status: "pending",
    });
  }
}

/** Payload of a gate-3 `blocked_unit` review item (created by GENERATING_SCRIPT). */
export interface BlockedUnitItem {
  unitKey: string;
  moduleKey: string;
  concept: string;
  blockedTerms: string[];
  narrationIds: string[];
}

/**
 * Gate 3 (M5): one review item per unit blocked on an unresolved
 * CONFIRM_WITH_INSTITUTION pronunciation. Idempotent: existing gate-3
 * blocked_unit items for the run are replaced, not duplicated; other gate-3
 * item kinds (e.g. failed_unit) are left alone.
 */
export async function replaceGate3BlockedUnitItems(
  ctx: MutationCtx,
  runId: Id<"runs">,
  items: BlockedUnitItem[]
): Promise<void> {
  const existing = await ctx.db
    .query("reviewItems")
    .withIndex("by_run_and_gate", (q) => q.eq("runId", runId).eq("gate", 3))
    .take(1000);
  for (const item of existing) {
    if (item.kind === "blocked_unit") {
      await ctx.db.delete(item._id);
    }
  }
  for (const item of items) {
    await ctx.db.insert("reviewItems", {
      runId,
      gate: 3,
      kind: "blocked_unit",
      payload: item,
      status: "pending",
    });
  }
}

/** Payload of a gate-3 `failed_unit` review item (created by GENERATING_ASSETS). */
export interface FailedUnitItem {
  unitKey: string;
  moduleKey: string;
  concept: string;
  cause: string;
  retryable: boolean;
}

/**
 * Gate 3 (M5): one review item per unit whose synthesis failed. Idempotent:
 * existing gate-3 failed_unit items for the run are replaced, not
 * duplicated; other gate-3 item kinds (e.g. blocked_unit) are left alone.
 */
export async function replaceGate3FailedUnitItems(
  ctx: MutationCtx,
  runId: Id<"runs">,
  items: FailedUnitItem[]
): Promise<void> {
  const existing = await ctx.db
    .query("reviewItems")
    .withIndex("by_run_and_gate", (q) => q.eq("runId", runId).eq("gate", 3))
    .take(1000);
  for (const item of existing) {
    if (item.kind === "failed_unit") {
      await ctx.db.delete(item._id);
    }
  }
  for (const item of items) {
    await ctx.db.insert("reviewItems", {
      runId,
      gate: 3,
      kind: "failed_unit",
      payload: item,
      status: "pending",
    });
  }
}

export const createGateReviewItems = internalMutation({
  args: {
    runId: v.id("runs"),
    gate: reviewGateValidator,
  },
  handler: async (ctx, args) => {
    await insertGateReviewItems(ctx, args.runId, args.gate);
    return null;
  },
});

// --- Gate-1 per-item resolution ---

const resolutionValidator = v.union(v.literal("approve"), v.literal("exclude"));

/**
 * Resolves a single gate-1 flagged-fact item:
 * - approve: the operator supplies sourceLabel + year; the fact is patched
 *   and unflagged (the flag floor is satisfied by the supplied attribution).
 * - exclude: the fact is marked excluded and becomes unavailable to the
 *   compiler in M4.
 */
export async function resolveReviewItemHelper(
  ctx: MutationCtx,
  args: {
    reviewItemId: Id<"reviewItems">;
    resolution: "approve" | "exclude";
    sourceLabel?: string;
    year?: number;
    reviewer: string;
  }
): Promise<void> {
  const item = await ctx.db.get(args.reviewItemId);
  if (!item) appError(AppErrorCode.REVIEW_ITEM_NOT_FOUND);
  if (item.status !== "pending") {
    appError(AppErrorCode.REVIEW_ITEM_ALREADY_RESOLVED);
  }
  const inventoryItemId = item.inventoryItemId;
  if (!inventoryItemId) appError(AppErrorCode.REVIEW_ITEM_NOT_FOUND);
  const inventoryRow = await ctx.db.get(inventoryItemId);
  if (!inventoryRow) appError(AppErrorCode.REVIEW_ITEM_NOT_FOUND);
  const fact = inventoryRow.body as Fact;

  if (args.resolution === "approve") {
    const sourceLabel = args.sourceLabel?.trim();
    if (!sourceLabel || args.year === undefined) {
      appError(AppErrorCode.REVIEW_ITEM_SOURCE_REQUIRED);
    }
    const updatedFact: Fact = {
      ...fact,
      sourceLabel,
      year: args.year,
      flagged: false,
    };
    delete updatedFact.flagReason;
    await ctx.db.patch(inventoryItemId, {
      body: updatedFact,
      flagged: false,
    });
    await ctx.db.patch(item._id, {
      status: "approved",
      reviewer: args.reviewer,
      decidedAt: Date.now(),
      payload: { ...(item.payload as object), fact: updatedFact },
    });
    return;
  }

  const excludedFact: Fact = { ...fact, excluded: true };
  await ctx.db.patch(inventoryItemId, {
    body: excludedFact,
    excluded: true,
  });
  await ctx.db.patch(item._id, {
    status: "rejected",
    reviewer: args.reviewer,
    decidedAt: Date.now(),
    payload: { ...(item.payload as object), fact: excludedFact },
  });
}

export const resolveReviewItem = internalMutation({
  args: {
    reviewItemId: v.id("reviewItems"),
    resolution: resolutionValidator,
    sourceLabel: v.optional(v.string()),
    year: v.optional(v.number()),
    reviewer: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await resolveReviewItemHelper(ctx, {
      reviewItemId: args.reviewItemId,
      resolution: args.resolution,
      ...(args.sourceLabel !== undefined
        ? { sourceLabel: args.sourceLabel }
        : {}),
      ...(args.year !== undefined ? { year: args.year } : {}),
      reviewer: args.reviewer ?? "system",
    });
    return null;
  },
});

/** Admin wrapper: resolve one gate-1 flagged-fact item. */
export const adminResolveReviewItem = mutation({
  args: {
    reviewItemId: v.id("reviewItems"),
    resolution: resolutionValidator,
    sourceLabel: v.optional(v.string()),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    await resolveReviewItemHelper(ctx, {
      reviewItemId: args.reviewItemId,
      resolution: args.resolution,
      ...(args.sourceLabel !== undefined
        ? { sourceLabel: args.sourceLabel }
        : {}),
      ...(args.year !== undefined ? { year: args.year } : {}),
      reviewer: admin.email,
    });
    return null;
  },
});

/** All review items for a run + gate, any status (walkthrough, eval, UI). */
export const listReviewItemsForRun = internalQuery({
  args: { runId: v.id("runs"), gate: reviewGateValidator },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reviewItems")
      .withIndex("by_run_and_gate", (q) =>
        q.eq("runId", args.runId).eq("gate", args.gate)
      )
      .take(1000);
  },
});

/** Admin variant of listReviewItemsForRun for the gate review UI. */
export const getRunReviewItems = query({
  args: { runId: v.id("runs"), gate: reviewGateValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("reviewItems")
      .withIndex("by_run_and_gate", (q) =>
        q.eq("runId", args.runId).eq("gate", args.gate)
      )
      .take(1000);
  },
});
