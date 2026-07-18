"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  avatarLookEvaluationSchema,
  type AvatarLookEvaluation,
} from "@counseliq/course-schema";
import { action, internalAction } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { completeStructured, createOpenRouterClient } from "../llm/client";
import { PROMPTS } from "../prompts";
import { fetchPrivateAvatarGroups, fetchPrivateAvatarLooks, type HeyGenLook } from "./heygen";

function sourceHash(look: HeyGenLook) {
  return createHash("sha256")
    .update(JSON.stringify({ id: look.lookId, name: look.name, preview: look.previewImageUrl, orientation: look.preferredOrientation, engines: look.supportedEngines, tags: look.tags, type: look.avatarType }))
    .digest("hex");
}

async function evaluateLook(ctx: ActionCtx, lookId: string): Promise<{ status: "evaluated" | "skipped" }> {
  const look = await ctx.runQuery(internal.pipeline.avatar.catalogueData.getAvatarLookForEvaluation, { lookId });
  if (!look?.previewImageUrl) return { status: "skipped" };
  const response = await fetch(look.previewImageUrl);
  if (!response.ok) return { status: "skipped" };
  const image = Buffer.from(await response.arrayBuffer()).toString("base64");
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0];
  const imageMimeType =
    mimeType === "image/jpeg" || mimeType === "image/webp" || mimeType === "image/png"
      ? mimeType
      : "image/png";
  const routing = await ctx.runQuery(internal.pipeline.queries.getLlmModelRoutingInternal, {});
  const result = await completeStructured<AvatarLookEvaluation>(
    createOpenRouterClient({ modelRouting: routing }),
    "evaluate-avatar-look",
    {
      system: PROMPTS["evaluate-avatar-look"].content,
      user: [
        { type: "image", base64Png: image, mimeType: imageMimeType },
        { type: "text", text: `HeyGen look: ${look.name}\nProvider tags: ${look.tags.join(", ") || "none"}\nOrientation: ${look.preferredOrientation ?? "unknown"}` },
      ],
      schemaName: "avatar_look_evaluation",
      jsonSchema: zodToJsonSchema(avatarLookEvaluationSchema, { $refStrategy: "none", target: "openAi" }) as Record<string, unknown>,
    },
    avatarLookEvaluationSchema
  );
  await ctx.runMutation(internal.pipeline.avatar.catalogueData.saveAvatarLookEvaluation, {
    lookId,
    evaluation: result.value,
    promptVersion: PROMPTS["evaluate-avatar-look"].versionTag,
    model: result.usages.at(-1)?.model ?? routing["evaluate-avatar-look"],
  });
  return { status: "evaluated" };
}

export const evaluateAvatarLook = internalAction({
  args: { lookId: v.string() },
  handler: async (ctx, args) => await evaluateLook(ctx, args.lookId),
});

/** Pull provider metadata, then visually evaluate only looks whose source hash changed. */
type SyncResult = {
  groups: number;
  looks: number;
  removedGroups: number;
  removedLooks: number;
  evaluated: number;
};

async function syncCatalog(ctx: ActionCtx): Promise<SyncResult> {
  const groups = await fetchPrivateAvatarGroups();
  const looks = (await Promise.all(groups.map((group) => fetchPrivateAvatarLooks(group.id)))).flat();
  const synced = await ctx.runMutation(internal.pipeline.avatar.catalogueData.upsertAvatarCatalog, {
    groups,
    looks: looks.map((look) => ({
      groupId: look.groupId,
      lookId: look.lookId,
      name: look.name,
      previewImageUrl: look.previewImageUrl ?? null,
      preferredOrientation: look.preferredOrientation ?? null,
      supportedEngines: look.supportedEngines ?? [],
      tags: look.tags,
      avatarType: look.avatarType,
      status: look.status,
      sourceHash: sourceHash(look),
    })),
  });
  let evaluated = 0;
  for (const lookId of synced.evaluateIds) {
    const result = await evaluateLook(ctx, lookId);
    if (result.status === "evaluated") evaluated += 1;
  }
  return {
    groups: synced.groups,
    looks: synced.looks,
    removedGroups: synced.removedGroups,
    removedLooks: synced.removedLooks,
    evaluated,
  };
}

export const syncAvatarCatalog = internalAction({
  args: {},
  handler: async (ctx): Promise<SyncResult> => await syncCatalog(ctx),
});

export const adminSyncAvatarCatalog = action({
  args: {},
  handler: async (ctx): Promise<SyncResult> => {
    await ctx.runQuery(internal.pipeline.queries.assertAdmin, {});
    return await syncCatalog(ctx);
  },
});

export const adminEvaluateAvatarLook = action({
  args: { lookId: v.string() },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.pipeline.queries.assertAdmin, {});
    return await evaluateLook(ctx, args.lookId);
  },
});
