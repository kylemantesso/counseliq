"use node";

import { v } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import {
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
  LlmError,
  type LlmClient,
  type LlmUsage,
} from "./llm/client";
import { type LlmModelRouting, type LlmTask } from "./llm/models";
import { PAGE_EXTRACTION_JSON_SCHEMA } from "./llm/schemas";
import { PROMPTS } from "./prompts";
import {
  restampPageExtraction,
  storePageExtraction,
  type StoredPageExtraction,
} from "./extraction/assemble";

/**
 * The real EXTRACTING stage (M3): per-page multimodal extraction fanned out
 * through a dedicated workpool, a merge pass consolidating concepts across
 * all docs of the run into one inventory. Never logs API keys, presigned
 * URLs, or page image bytes.
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

function defaultClient(modelRouting?: Partial<LlmModelRouting>): LlmClient {
  return createOpenRouterClient({ modelRouting });
}

function pageCacheKey(pageHash: string, task: LlmTask, model: string): string {
  return `${pageHash}:${PROMPTS[task].versionTag}:${model}`;
}

function isStructuredOutputFailure(error: unknown): error is LlmError {
  return (
    error instanceof LlmError &&
    !error.retryable &&
    error.message.includes("structured output failed validation after retry")
  );
}

function emptyFallbackExtraction(
  provenanceId: string,
  cause: string
): StoredPageExtraction {
  return {
    provenanceId,
    concepts: [],
    facts: [],
    entities: [],
    quotes: [],
    fallbackCause: cause.slice(0, 500),
  };
}

async function recordInstitutionScopedUsages(
  ctx: ActionCtx,
  institutionId: Id<"institutions">,
  stage: LlmTask,
  usages: LlmUsage[],
  sourceDocId?: Id<"sourceDocs">
): Promise<void> {
  for (const usage of usages) {
    await ctx.runMutation(internal.pipeline.llmCalls.recordLlmCall, {
      institutionId,
      ...(sourceDocId ? { sourceDocId } : {}),
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
 * re-runs reuse the stored result instead of calling the LLM again. This is
 * upload-time work and is deliberately scoped to an institution, not a run.
 */
export const extractPage = internalAction({
  args: {
    institutionId: v.id("institutions"),
    sourceDocId: v.id("sourceDocs"),
    n: v.number(),
    extractModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.runQuery(
      internal.pipeline.inventory.getPageForExtraction,
      { sourceDocId: args.sourceDocId, n: args.n }
    );
    const extractModel =
      args.extractModel ??
      (
        await ctx.runQuery(internal.pipeline.queries.getLlmModelRoutingInternal, {})
      )["extract-page"];
    const cacheKey = pageCacheKey(page.hash, "extract-page", extractModel);

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

    let value: LlmPageExtraction;
    let usages: LlmUsage[] = [];
    try {
      const response = await completeStructured<LlmPageExtraction>(
        defaultClient({ "extract-page": extractModel }),
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
      value = response.value;
      usages = response.usages;
    } catch (error) {
      if (!isStructuredOutputFailure(error)) {
        throw error;
      }
      const fallback = emptyFallbackExtraction(page.provenanceId, error.message);
      await ctx.runMutation(internal.pipeline.inventory.savePageExtraction, {
        sourceDocId: args.sourceDocId,
        n: args.n,
        cacheKey,
        result: fallback,
      });
      console.warn(
        `[pipeline] sourceDoc ${args.sourceDocId} page ${args.n}: extract-page output invalid after retries; stored empty fallback`
      );
      return { status: "fallback" as const };
    }
    await recordInstitutionScopedUsages(
      ctx,
      args.institutionId,
      "extract-page",
      usages,
      args.sourceDocId
    );

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

type SourceDocExtractionResult =
  | { status: "ok"; pages: number }
  | { status: "failed"; cause: string };

/** Upload-time extraction for standalone source docs (no run yet). */
export const extractFactsForSourceDoc = internalAction({
  args: { sourceDocId: v.id("sourceDocs") },
  handler: async (ctx, args): Promise<SourceDocExtractionResult> => {
    try {
      const doc = await ctx.runQuery(
        internal.pipeline.ingestion.getSourceDocForDispatch,
        {
          sourceDocId: args.sourceDocId,
        }
      );
      if (!doc || doc.status !== "converted" || doc.runId) {
        return { status: "ok", pages: 0 };
      }

      const slides = await ctx.runQuery(
        internal.pipeline.ingestion.listSlidesForDoc,
        {
          sourceDocId: args.sourceDocId,
        }
      );
      if (slides.length === 0) {
        return { status: "ok", pages: 0 };
      }

      const extractModel = (
        await ctx.runQuery(internal.pipeline.queries.getLlmModelRoutingInternal, {})
      )["extract-page"];

      const sequential = process.env.EXTRACTION_MODE === "sequential";
      if (sequential) {
        for (const slide of slides) {
          await ctx.runAction(internal.pipeline.extract.extractPage, {
            institutionId: doc.institutionId,
            sourceDocId: args.sourceDocId,
            n: slide.n,
            extractModel,
          });
        }
      } else {
        const workIds = await extractionPool.enqueueActionBatch(
          ctx,
          internal.pipeline.extract.extractPage,
          slides.map((slide) => ({
            institutionId: doc.institutionId,
            sourceDocId: args.sourceDocId,
            n: slide.n,
            extractModel,
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
              cause: `source-doc extraction timed out after ${timeoutMs}ms (${finished}/${workIds.length} pages finished)`,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      }

      const rows = await ctx.runQuery(
        internal.pipeline.inventory.listPageExtractionsForDoc,
        { sourceDocId: args.sourceDocId }
      );
      const extractedPages = new Set(rows.map((row) => row.n));
      const missing = slides.filter((slide) => !extractedPages.has(slide.n));
      if (missing.length > 0) {
        return {
          status: "failed",
          cause: `${missing.length} page(s) failed extraction (first: page ${missing[0].n})`,
        };
      }

      return { status: "ok", pages: slides.length };
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      console.error(
        `[pipeline] sourceDoc ${args.sourceDocId}: upload-time extraction failed`,
        cause
      );
      return { status: "failed", cause };
    }
  },
});
