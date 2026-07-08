"use node";

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { completeStructured, createOpenRouterClient } from "./llm/client";
import { modelForTask } from "./llm/models";
import { ASSET_TAGS_JSON_SCHEMA } from "./llm/schemas";
import { llmAssetTagsSchema, type LlmAssetTags } from "./assetsTagSchema";
import { PROMPTS } from "./prompts";
import { extractionPool } from "./extract";

/**
 * The tag-asset vision pass (M6): batch over an institution's untagged
 * catalogue assets through the extraction workpool (same vision workload
 * class as extract-page). Idempotent per asset via the
 * (tagPromptVersion, tagModel) stamp; bumping the prompt version re-tags
 * everything on the next run. Logged to llmCalls under institutionId (no
 * run). Code floors live in assetsCatalogue.saveAssetTags — the model can
 * never write rights and never lower identifiablePeople.
 */

async function fetchImageBase64(ctx: ActionCtx, key: string): Promise<string> {
  const { url } = await ctx.runAction(internal.pipeline.objectStore.presignGet, {
    key,
  });
  const response = await fetch(url);
  if (!response.ok) {
    // Never include the presigned URL in the error.
    throw new Error(`failed to fetch asset image (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

type TagResult =
  | { status: "tagged" }
  | { status: "cached" }
  | { status: "skipped"; reason: string };

async function tagAssetInner(
  ctx: ActionCtx,
  assetId: Id<"assets">,
  force: boolean
): Promise<TagResult> {
  const asset = await ctx.runQuery(
    internal.pipeline.assetsCatalogue.getAssetForTagging,
    { assetId }
  );
  if (asset.kind !== "image" && asset.kind !== "video") {
    return { status: "skipped", reason: `kind ${asset.kind} is not taggable` };
  }
  const promptVersion = PROMPTS["tag-asset"].versionTag;
  const model = modelForTask("tag-asset");
  if (
    !force &&
    asset.taggedAt !== undefined &&
    asset.tagPromptVersion === promptVersion &&
    asset.tagModel === model
  ) {
    return { status: "cached" };
  }

  // Vision input: images use their thumbnail when present (cheaper, plenty
  // for tagging); videos MUST use the poster frame — the mp4 itself is not
  // a vision input.
  const imageKey =
    asset.kind === "video" ? asset.thumbKey : asset.thumbKey ?? asset.objectKey;
  if (!imageKey) {
    return { status: "skipped", reason: "no poster/thumbnail to tag from" };
  }
  const base64Png = await fetchImageBase64(ctx, imageKey);

  const contextLines = [
    `Asset kind: ${asset.kind}${asset.kind === "video" ? " (you are shown its poster frame)" : ""}.`,
    asset.originalName ? `File name: ${asset.originalName}` : null,
    asset.durationMs
      ? `Video duration: ${Math.round(asset.durationMs / 1000)}s`
      : null,
    asset.width && asset.height
      ? `Dimensions: ${asset.width}x${asset.height}`
      : null,
    asset.origin === "deck_extracted"
      ? `Origin: extracted from the institution's source deck (${asset.sourceProvenance ?? "unknown page"}).`
      : "Origin: uploaded to the institution's asset library.",
  ].filter((line): line is string => line !== null);

  const { value, usages } = await completeStructured<LlmAssetTags>(
    createOpenRouterClient(),
    "tag-asset",
    {
      system: PROMPTS["tag-asset"].content,
      user: [
        { type: "image", base64Png },
        { type: "text", text: contextLines.join("\n") },
      ],
      schemaName: "asset_tags",
      jsonSchema: ASSET_TAGS_JSON_SCHEMA,
    },
    llmAssetTagsSchema
  );
  for (const usage of usages) {
    await ctx.runMutation(internal.pipeline.llmCalls.recordLlmCall, {
      institutionId: asset.institutionId,
      stage: "tag-asset",
      promptVersion,
      model: usage.model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: usage.costUsd,
      latencyMs: usage.latencyMs,
    });
  }

  await ctx.runMutation(internal.pipeline.assetsCatalogue.saveAssetTags, {
    assetId,
    caption: value.caption,
    tags: value.tags,
    subjects: value.subjects,
    ...(value.setting !== null ? { setting: value.setting } : {}),
    ...(value.textInImage !== null ? { textInImage: value.textInImage } : {}),
    qualityScore: value.qualityScore,
    identifiablePeople: value.identifiablePeople,
    suggestedUses: value.suggestedUses,
    tagPromptVersion: promptVersion,
    tagModel: model,
    taggedAt: Date.now(),
  });
  return { status: "tagged" };
}

/** Workpool entry point: tag one asset (idempotent via the tag stamp). */
export const tagAsset = internalAction({
  args: { assetId: v.id("assets"), force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<TagResult> => {
    return await tagAssetInner(ctx, args.assetId, args.force ?? false);
  },
});

type TagBatchResult = {
  status: "ok";
  eligible: number;
};

/**
 * Orchestrator: fan every untagged catalogue asset of the institution
 * through the extraction workpool. Scheduled automatically after ingest
 * callbacks; safe to re-run any time (the per-asset tag stamp makes
 * duplicates cheap no-ops).
 *
 * Deliberately enqueue-and-return, NO completion polling: dozens of ingest
 * callbacks can each schedule this, and a polling loop per invocation
 * starves the very action executor the tagAsset workers need (observed on
 * the local backend: 73 retro callbacks → 73 pollers → tagging crawled).
 * Completion is observable from the data (`getTaggingStatusInternal`),
 * which is how the eval script and the library page already watch it.
 */
export const tagUntaggedAssets = internalAction({
  args: { institutionId: v.id("institutions") },
  handler: async (ctx, args): Promise<TagBatchResult> => {
    if (!process.env.OPENROUTER_API_KEY) {
      // Ingest callbacks schedule this blindly; a deployment without LLM
      // config (local dev without keys) just leaves assets untagged.
      console.log("[assets] tagging skipped: OPENROUTER_API_KEY not configured");
      return { status: "ok", eligible: 0 };
    }
    const untagged = await ctx.runQuery(
      internal.pipeline.assetsCatalogue.listUntaggedAssets,
      {
        institutionId: args.institutionId,
        promptVersion: PROMPTS["tag-asset"].versionTag,
        model: modelForTask("tag-asset"),
      }
    );
    if (untagged.length === 0) return { status: "ok", eligible: 0 };

    const enqueueArgs = untagged.map((asset) => ({ assetId: asset._id }));
    if (process.env.EXTRACTION_MODE === "sequential") {
      for (const itemArgs of enqueueArgs) {
        await ctx.runAction(internal.pipeline.assetsTagging.tagAsset, itemArgs);
      }
      return { status: "ok", eligible: untagged.length };
    }

    await extractionPool.enqueueActionBatch(
      ctx,
      internal.pipeline.assetsTagging.tagAsset,
      enqueueArgs
    );
    return { status: "ok", eligible: untagged.length };
  },
});

/** Admin: force re-tag one asset (prompt/model change or bad tags). */
export const adminRetagAsset = action({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args): Promise<TagResult> => {
    await ctx.runQuery(internal.pipeline.queries.assertAdmin, {});
    return await ctx.runAction(internal.pipeline.assetsTagging.tagAsset, {
      assetId: args.assetId,
      force: true,
    });
  },
});
