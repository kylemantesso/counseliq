"use node";

import { v } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import {
  llmInferredThemeSchema,
  llmMergeResultSchema,
  llmPageExtractionSchema,
  type LlmPageExtraction,
} from "@counseliq/course-schema";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { components, internal } from "../_generated/api";
import {
  completeStructured,
  createOpenRouterClient,
  type LlmClient,
  type LlmUsage,
} from "./llm/client";
import { currentModelRouting, modelForTask, type LlmTask } from "./llm/models";
import {
  INFERRED_THEME_JSON_SCHEMA,
  MERGE_RESULT_JSON_SCHEMA,
  PAGE_EXTRACTION_JSON_SCHEMA,
} from "./llm/schemas";
import { PROMPTS } from "./prompts";
import {
  assembleInventory,
  preGroupConcepts,
  restampPageExtraction,
  storePageExtraction,
  type StoredPageExtraction,
} from "./extraction/assemble";

/**
 * The real EXTRACTING stage (M3): per-page multimodal extraction fanned out
 * through a dedicated workpool, a merge pass consolidating concepts across
 * all docs of the run into one inventory, and theme inference for pdf-native
 * docs. Never logs API keys, presigned URLs, or page image bytes.
 */

const DEFAULT_PARALLELISM = 2;
const EXTRACTION_TIMEOUT_MS_DEFAULT = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

function extractionParallelism(): number {
  const raw = Number(process.env.EXTRACTION_PARALLELISM);
  return Number.isFinite(raw) && raw >= 1
    ? Math.floor(raw)
    : DEFAULT_PARALLELISM;
}

export const extractionPool = new Workpool(components.extractionPool, {
  maxParallelism: extractionParallelism(),
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});

function defaultClient(): LlmClient {
  return createOpenRouterClient();
}

function pageCacheKey(pageHash: string, task: LlmTask): string {
  return `${pageHash}:${PROMPTS[task].versionTag}:${modelForTask(task)}`;
}

async function recordUsages(
  ctx: ActionCtx,
  runId: Id<"runs">,
  stage: LlmTask,
  usages: LlmUsage[]
): Promise<void> {
  for (const usage of usages) {
    await ctx.runMutation(internal.pipeline.llmCalls.recordLlmCall, {
      runId,
      stage,
      promptVersion: PROMPTS[stage].versionTag,
      model: usage.model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: usage.costUsd,
      latencyMs: usage.latencyMs,
    });
  }
}

async function fetchPngBase64(ctx: ActionCtx, key: string): Promise<string> {
  const { url } = await ctx.runAction(
    internal.pipeline.objectStore.presignGet,
    { key }
  );
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch page image (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

/**
 * Extracts the knowledge inventory of a single page. Idempotent: cached by
 * page content hash + prompt version + model, so workpool retries and
 * re-runs reuse the stored result instead of calling the LLM again.
 */
export const extractPage = internalAction({
  args: {
    runId: v.id("runs"),
    sourceDocId: v.id("sourceDocs"),
    n: v.number(),
  },
  handler: async (ctx, args) => {
    const page = await ctx.runQuery(
      internal.pipeline.inventory.getPageForExtraction,
      { sourceDocId: args.sourceDocId, n: args.n }
    );
    const cacheKey = pageCacheKey(page.hash, "extract-page");

    const cached = await ctx.runQuery(
      internal.pipeline.inventory.getPageExtraction,
      { sourceDocId: args.sourceDocId, n: args.n, cacheKey }
    );
    if (cached !== null) {
      const cachedStored = cached as StoredPageExtraction;
      if (cachedStored.provenanceId !== page.provenanceId) {
        // Content-addressed hit from another sourceDoc row: re-stamp onto
        // THIS page's provenance and persist so the next lookup is exact.
        await ctx.runMutation(internal.pipeline.inventory.savePageExtraction, {
          sourceDocId: args.sourceDocId,
          n: args.n,
          cacheKey,
          result: restampPageExtraction(cachedStored, page.provenanceId),
        });
      }
      return { status: "cached" as const };
    }

    const base64Png = await fetchPngBase64(ctx, page.pngKey);
    const shapeHint = page.docShape
      ? `Document shape hint: ${page.docShape}.`
      : "";
    const contextText = [
      `Document kind: ${page.docKind}. ${shapeHint}`,
      `This is page ${args.n} of ${page.pageCount}.`,
      "",
      "Extracted text layer:",
      page.text || "(empty)",
      "",
      "Speaker notes:",
      page.notes || "(none)",
    ].join("\n");

    const { value, usages } = await completeStructured<LlmPageExtraction>(
      defaultClient(),
      "extract-page",
      {
        system: PROMPTS["extract-page"].content,
        user: [
          { type: "image", base64Png },
          { type: "text", text: contextText },
        ],
        schemaName: "page_extraction",
        jsonSchema: PAGE_EXTRACTION_JSON_SCHEMA,
      },
      llmPageExtractionSchema
    );
    await recordUsages(ctx, args.runId, "extract-page", usages);

    // Provenance stamping + code-level flag floor happen here, in code.
    const stored = storePageExtraction(page.provenanceId, value);

    await ctx.runMutation(internal.pipeline.inventory.savePageExtraction, {
      sourceDocId: args.sourceDocId,
      n: args.n,
      cacheKey,
      result: stored,
    });
    return { status: "extracted" as const };
  },
});

type ExtractionResult =
  | {
      status: "ok";
      counts: {
        total: number;
        concepts: number;
        facts: number;
        entities: number;
        quotes: number;
        flaggedFacts: number;
      };
      pages: number;
    }
  | { status: "failed"; cause: string };

/**
 * Orchestrates the whole EXTRACTING stage for a run: fan out per-page
 * extraction (workpool, or sequential with EXTRACTION_MODE=sequential),
 * merge concepts across all docs into ONE inventory, infer candidate themes
 * for pdf-native docs, and write inventoryItems idempotently.
 */
export const runExtraction = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<ExtractionResult> => {
    try {
      return await runExtractionInner(ctx, args.runId);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      console.error(`[pipeline] run ${args.runId}: extraction failed`, cause);
      return { status: "failed", cause };
    }
  },
});

async function runExtractionInner(
  ctx: ActionCtx,
  runId: Id<"runs">
): Promise<ExtractionResult> {
  const plan = await ctx.runQuery(
    internal.pipeline.inventory.getExtractionPlan,
    { runId }
  );
  if (plan.pages.length === 0) {
    return { status: "failed", cause: "no converted pages to extract" };
  }

  await ctx.runMutation(internal.pipeline.inventory.setRunPromptVersions, {
    runId,
    promptVersions: {
      "extract-page": PROMPTS["extract-page"].versionTag,
      "merge-inventory": PROMPTS["merge-inventory"].versionTag,
      "infer-theme": PROMPTS["infer-theme"].versionTag,
      models: currentModelRouting(),
    },
  });

  // --- Fan out per-page extraction ---
  const sequential = process.env.EXTRACTION_MODE === "sequential";
  console.log(
    `[pipeline] run ${runId}: extracting ${plan.pages.length} page(s) ` +
      `(${sequential ? "sequential" : `workpool, parallelism ${extractionParallelism()}`})`
  );

  if (sequential) {
    for (const page of plan.pages) {
      await ctx.runAction(internal.pipeline.extract.extractPage, {
        runId,
        sourceDocId: page.sourceDocId,
        n: page.n,
      });
    }
  } else {
    const workIds = await extractionPool.enqueueActionBatch(
      ctx,
      internal.pipeline.extract.extractPage,
      plan.pages.map((page) => ({
        runId,
        sourceDocId: page.sourceDocId,
        n: page.n,
      }))
    );
    const timeoutMs = Number(
      process.env.EXTRACTION_TIMEOUT_MS ?? EXTRACTION_TIMEOUT_MS_DEFAULT
    );
    const startedAt = Date.now();
    for (;;) {
      const statuses = await extractionPool.statusBatch(ctx, workIds);
      const finished = statuses.filter((s) => s.state === "finished").length;
      if (finished === workIds.length) break;
      if (Date.now() - startedAt > timeoutMs) {
        return {
          status: "failed",
          cause: `page extraction timed out after ${timeoutMs}ms (${finished}/${workIds.length} pages finished)`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  // --- Collect page results (verify none failed silently) ---
  const rows = await ctx.runQuery(
    internal.pipeline.inventory.listPageExtractionsForRun,
    { runId }
  );
  const byPage = new Map<string, StoredPageExtraction>();
  for (const row of rows) {
    byPage.set(`${row.sourceDocId}:${row.n}`, row.result);
  }
  const missing = plan.pages.filter(
    (p) => !byPage.has(`${p.sourceDocId}:${p.n}`)
  );
  if (missing.length > 0) {
    return {
      status: "failed",
      cause: `${missing.length} page(s) failed extraction after retries (first: page ${missing[0].n})`,
    };
  }
  const storedPages = plan.pages.map(
    (p) => byPage.get(`${p.sourceDocId}:${p.n}`) as StoredPageExtraction
  );

  // --- Merge pass: one inventory across all docs of the run ---
  const groups = preGroupConcepts(storedPages);
  let mergeResult = null;
  if (groups.length > 0) {
    const mergeInput = groups.map((g) => ({
      key: g.key,
      title: g.title,
      summary: g.summary,
    }));
    const { value, usages } = await completeStructured(
      defaultClient(),
      "merge-inventory",
      {
        system: PROMPTS["merge-inventory"].content,
        user: [
          {
            type: "text",
            text: `Candidate concepts:\n${JSON.stringify(mergeInput, null, 2)}`,
          },
        ],
        schemaName: "merge_result",
        jsonSchema: MERGE_RESULT_JSON_SCHEMA,
      },
      llmMergeResultSchema
    );
    await recordUsages(ctx, runId, "merge-inventory", usages);
    mergeResult = value;
  }

  const items = assembleInventory(storedPages, groups, mergeResult);
  const counts = await ctx.runMutation(
    internal.pipeline.inventory.replaceInventory,
    { runId, items }
  );

  // --- Theme inference for pdf-native docs (candidates only; non-fatal) ---
  for (const doc of plan.docs) {
    if (doc.theme !== null) continue;
    try {
      await inferThemeForDoc(ctx, runId, doc._id, plan.pages);
    } catch (error) {
      console.error(
        `[pipeline] run ${runId}: theme inference failed for doc ${doc._id} (non-fatal)`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  console.log(
    `[pipeline] run ${runId}: extraction complete — ${counts.total} items ` +
      `(${counts.concepts} concepts, ${counts.facts} facts, ${counts.flaggedFacts} flagged)`
  );
  return { status: "ok", counts, pages: plan.pages.length };
}

async function inferThemeForDoc(
  ctx: ActionCtx,
  runId: Id<"runs">,
  sourceDocId: Id<"sourceDocs">,
  allPages: Array<{ sourceDocId: Id<"sourceDocs">; n: number; pngKey: string }>
): Promise<void> {
  const docPages = allPages
    .filter((p) => p.sourceDocId === sourceDocId)
    .sort((a, b) => a.n - b.n);
  if (docPages.length === 0) return;

  // 2-3 representative renders: first, middle, last.
  const picks = [
    docPages[0],
    docPages[Math.floor(docPages.length / 2)],
    docPages[docPages.length - 1],
  ].filter(
    (page, index, arr) => arr.findIndex((p) => p.n === page.n) === index
  );

  const images = await Promise.all(
    picks.map((p) => fetchPngBase64(ctx, p.pngKey))
  );

  const { value, usages } = await completeStructured(
    defaultClient(),
    "infer-theme",
    {
      system: PROMPTS["infer-theme"].content,
      user: [
        ...images.map((base64Png) => ({
          type: "image" as const,
          base64Png,
        })),
        {
          type: "text",
          text: `These are ${picks.length} representative pages from the same document. Infer the brand theme candidates.`,
        },
      ],
      schemaName: "inferred_theme",
      jsonSchema: INFERRED_THEME_JSON_SCHEMA,
    },
    llmInferredThemeSchema
  );
  await recordUsages(ctx, runId, "infer-theme", usages);

  await ctx.runMutation(internal.pipeline.inventory.setDocInferredTheme, {
    sourceDocId,
    colors: value.colors,
    fonts: value.fonts,
  });
}
