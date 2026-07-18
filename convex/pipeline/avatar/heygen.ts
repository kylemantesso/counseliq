"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireAdmin } from "../../admin";
import { AppErrorCode, appError } from "../../errors";
import {
  createObjectStoreClient,
  getObjectBytes,
  putObjectIfAbsent,
} from "../objectStore";
import type { AvatarLook } from "@counseliq/course-schema";
import { heyGenAudioFilename, heyGenVideoTitle } from "./videoTitle";

const HEYGEN_API_URL = "https://api.heygen.com/v3";

export type HeyGenLook = Omit<AvatarLook, "avatarType"> & {
  tags: string[];
  avatarType: string;
  status: string | null;
};

export function requireHeyGenKey() {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) appError(AppErrorCode.AVATAR_NOT_CONFIGURED);
  return key;
}

function callbackUrl() {
  const explicit = process.env.HEYGEN_WEBHOOK_URL;
  if (explicit) return explicit;
  const site = process.env.CONVEX_SITE_URL;
  return site ? `${site.replace(/\/$/, "")}/heygen/webhook` : null;
}

function heyGenIdempotencyKey(inputHash: string) {
  return `counseliq:${createHash("sha256").update(inputHash).digest("hex")}`;
}

async function uploadHeyGenAudioAsset(
  audioKey: string,
  idempotencySource: string,
  filename: string
): Promise<string> {
  const bytes = await getObjectBytes(createObjectStoreClient(), audioKey);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }),
    filename
  );
  const response = await fetch(`${HEYGEN_API_URL}/assets`, {
    method: "POST",
    headers: {
      "x-api-key": requireHeyGenKey(),
      "idempotency-key": heyGenIdempotencyKey(`audio:${idempotencySource}`),
    },
    body: form,
  });
  const body = (await response.json().catch(() => null)) as {
    data?: { asset_id?: string };
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok || !body?.data?.asset_id) {
    const error = new Error(body?.error?.message ?? `HeyGen asset upload HTTP ${response.status}`);
    (error as Error & { retryable?: boolean; code?: string }).retryable =
      response.status === 429 || response.status >= 500;
    (error as Error & { retryable?: boolean; code?: string }).code =
      body?.error?.code ?? `heygen_asset_http_${response.status}`;
    throw error;
  }
  return body.data.asset_id;
}

async function heyGenEnvelope(path: string, init?: RequestInit) {
  const response = await fetch(`${HEYGEN_API_URL}${path}`, {
    ...init,
    headers: {
      "x-api-key": requireHeyGenKey(),
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => null)) as {
    data?: unknown;
    next_token?: string | null;
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `HeyGen HTTP ${response.status}`);
    (error as Error & { retryable?: boolean; code?: string }).retryable = response.status === 429 || response.status >= 500;
    (error as Error & { retryable?: boolean; code?: string }).code = body?.error?.code ?? `heygen_http_${response.status}`;
    throw error;
  }
  return body;
}

export async function heyGenJson(path: string, init?: RequestInit) {
  return (await heyGenEnvelope(path, init))?.data;
}

type HeyGenUserBilling = {
  billing_type?: string | null;
  wallet?: {
    currency?: string;
    remaining_balance?: number | null;
    auto_reload?: { enabled?: boolean } | null;
  } | null;
  subscription?: {
    plan?: string;
    credits?: {
      premium_credits?: { remaining?: number | null; resets_at?: string | null } | null;
      add_on_credits?: { remaining?: number | null } | null;
    };
  } | null;
  usage_based?: {
    spending_current_usd?: number | null;
    spending_cap_usd?: number | null;
    included_credits?: number | null;
    remaining_credits?: number | null;
  } | null;
};

async function fetchHeyGenBilling() {
  const data = (await heyGenJson("/users/me")) as HeyGenUserBilling | undefined;
  if (!data) appError(AppErrorCode.AVATAR_NOT_CONFIGURED);

  if (data.billing_type === "wallet" && data.wallet) {
    return {
      billingType: "wallet" as const,
      currency: data.wallet.currency ?? "usd",
      remaining: data.wallet.remaining_balance ?? null,
      autoReload: data.wallet.auto_reload?.enabled ?? false,
      plan: null,
      resetsAt: null,
      spendingCurrentUsd: null,
      spendingCapUsd: null,
    };
  }
  if (data.billing_type === "subscription" && data.subscription) {
    const premium = data.subscription.credits?.premium_credits?.remaining ?? 0;
    const addOn = data.subscription.credits?.add_on_credits?.remaining ?? 0;
    return {
      billingType: "subscription" as const,
      currency: "credits",
      remaining: premium + addOn,
      autoReload: false,
      plan: data.subscription.plan ?? null,
      resetsAt: data.subscription.credits?.premium_credits?.resets_at ?? null,
      spendingCurrentUsd: null,
      spendingCapUsd: null,
    };
  }
  if (data.billing_type === "usage_based" && data.usage_based) {
    return {
      billingType: "usage_based" as const,
      currency: "credits",
      remaining: data.usage_based.remaining_credits ?? null,
      autoReload: false,
      plan: null,
      resetsAt: null,
      spendingCurrentUsd: data.usage_based.spending_current_usd ?? null,
      spendingCapUsd: data.usage_based.spending_cap_usd ?? null,
    };
  }
  return {
    billingType: data.billing_type ?? "unknown",
    currency: "credits",
    remaining: null,
    autoReload: false,
    plan: null,
    resetsAt: null,
    spendingCurrentUsd: null,
    spendingCapUsd: null,
  };
}

export const adminGetHeyGenBilling = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.pipeline.queries.assertAdmin, {});
    return await fetchHeyGenBilling();
  },
});

export const getHeyGenBillingInternal = internalAction({
  args: {},
  handler: async () => await fetchHeyGenBilling(),
});

export const getHeyGenVideoStatusesInternal = internalAction({
  args: { providerJobIds: v.array(v.string()) },
  handler: async (_ctx, args) => {
    const statuses = [];
    for (const providerJobId of args.providerJobIds.slice(0, 50)) {
      const data = (await heyGenJson(
        `/videos/${encodeURIComponent(providerJobId)}`
      )) as {
        id?: string;
        status?: string;
        duration?: number;
        failure_code?: string | null;
      } | undefined;
      statuses.push({
        providerJobId,
        status: data?.status ?? "unknown",
        duration: data?.duration ?? null,
        failureCode: data?.failure_code ?? null,
      });
    }
    return statuses;
  },
});

function toLook(value: unknown): HeyGenLook | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") return null;
  return {
    groupId: typeof record.group_id === "string" ? record.group_id : "",
    lookId: record.id,
    name: record.name,
    previewImageUrl: typeof record.preview_image_url === "string" ? record.preview_image_url : null,
    preferredOrientation:
      record.preferred_orientation === "portrait" || record.preferred_orientation === "landscape" || record.preferred_orientation === "square"
        ? record.preferred_orientation
        : null,
    supportedEngines: Array.isArray(record.supported_api_engines)
      ? record.supported_api_engines.filter((item): item is string => typeof item === "string")
      : [],
    tags: Array.isArray(record.tags) ? record.tags.filter((item): item is string => typeof item === "string") : [],
    avatarType: typeof record.avatar_type === "string" ? record.avatar_type : "unknown",
    status: typeof record.status === "string" ? record.status : null,
  };
}

export async function fetchPrivateAvatarGroups() {
  const groups: Array<{
    id: string;
    name: string;
    previewImageUrl: string | null;
    looksCount: number;
    status: string | null;
    consentStatus: string | null;
  }> = [];
  let token: string | null = null;
  do {
    const suffix = token ? `&token=${encodeURIComponent(token)}` : "";
    const envelope = await heyGenEnvelope(`/avatars?ownership=private&limit=50${suffix}`);
    const data = envelope?.data as unknown[];
    for (const value of Array.isArray(data) ? data : []) {
      const record = value as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.name !== "string") continue;
      groups.push({
        id: record.id,
        name: record.name,
        previewImageUrl: typeof record.preview_image_url === "string" ? record.preview_image_url : null,
        looksCount: typeof record.looks_count === "number" ? record.looks_count : 0,
        status: typeof record.status === "string" ? record.status : null,
        consentStatus: typeof record.consent_status === "string" ? record.consent_status : null,
      });
    }
    token =
      envelope && "next_token" in envelope && typeof envelope.next_token === "string"
        ? envelope.next_token
        : null;
  } while (token !== null && groups.length < 500);
  return groups;
}

export async function fetchPrivateAvatarLooks(groupId: string): Promise<HeyGenLook[]> {
  const looks: HeyGenLook[] = [];
  let token: string | null = null;
  do {
    const suffix = token ? `&token=${encodeURIComponent(token)}` : "";
    const envelope = await heyGenEnvelope(
      `/avatars/looks?ownership=private&group_id=${encodeURIComponent(groupId)}&limit=50${suffix}`
    );
    const data = envelope?.data as unknown[];
    looks.push(
      ...(Array.isArray(data) ? data : [])
        .map(toLook)
        .filter(
          (look): look is HeyGenLook =>
            look !== null &&
            look.groupId === groupId &&
            look.lookId !== look.groupId &&
            (look.status === null || look.status === "completed")
        )
    );
    token =
      envelope && "next_token" in envelope && typeof envelope.next_token === "string"
        ? envelope.next_token
        : null;
  } while (token !== null && looks.length < 500);
  return looks;
}

export const adminListAvatarGroups = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.pipeline.queries.assertAdmin, {});
    return await fetchPrivateAvatarGroups();
  },
});

export const adminListAvatarLooks = action({
  args: { groupId: v.string() },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.pipeline.queries.assertAdmin, {});
    return await fetchPrivateAvatarLooks(args.groupId);
  },
});

export const listAvatarLooksInternal = internalAction({
  args: { groupId: v.string() },
  handler: async (_ctx, args): Promise<HeyGenLook[]> => {
    return await fetchPrivateAvatarLooks(args.groupId);
  },
});

/** Submit queued avatar videos after their exact narration audio is available. */
export const dispatchQueuedAvatarJobs = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<{ submitted: number; failed: number }> => {
    await ctx.runMutation(internal.pipeline.avatar.jobs.createQueuedAvatarJobs, { runId: args.runId });
    const webhookUrl = callbackUrl();
    if (!webhookUrl) appError(AppErrorCode.AVATAR_NOT_CONFIGURED);
    const jobs = await ctx.runQuery(internal.pipeline.avatar.jobs.listQueuedAvatarJobs, { runId: args.runId });
    const submissionContext = await ctx.runQuery(
      internal.pipeline.avatar.jobs.getAvatarSubmissionContext,
      { runId: args.runId }
    );
    const unitContextById = new Map(
      submissionContext.units.map((unit) => [String(unit.unitId), unit])
    );
    let submitted = 0;
    for (const job of jobs) {
      try {
        const unitContext = unitContextById.get(String(job.unitId));
        const title = heyGenVideoTitle({
          courseTitle: submissionContext.courseTitle,
          runId: String(args.runId),
          unitKey: unitContext?.unitKey ?? `unit-${job.unitIndex + 1}`,
          unitTitle: unitContext?.title ?? job.moduleId,
        });
        const audioAssetId =
          job.heygenAudioAssetId ??
          (await uploadHeyGenAudioAsset(
            job.audioKey,
            job.inputHash,
            heyGenAudioFilename(title)
          ));
        if (!job.heygenAudioAssetId) {
          await ctx.runMutation(internal.pipeline.avatar.jobs.markHeyGenAudioAsset, {
            jobId: job._id,
            assetId: audioAssetId,
          });
        }
        const data = (await heyGenJson("/videos", {
          method: "POST",
          headers: {
            "idempotency-key": heyGenIdempotencyKey(
              `${job.inputHash}:attempt:${job.attempts + 1}`
            ),
          },
          body: JSON.stringify({
            type: "avatar",
            avatar_id: job.look.lookId,
            audio_asset_id: audioAssetId,
            aspect_ratio: "9:16",
            resolution: "1080p",
            fit: "cover",
            output_format: "mp4",
            engine: { type: job.engine },
            callback_url: webhookUrl,
            callback_id: String(job._id),
            title,
          }),
        })) as { video_id?: string };
        if (!data?.video_id) throw new Error("HeyGen did not return a video id");
        await ctx.runMutation(internal.pipeline.avatar.jobs.markAvatarSubmitted, { jobId: job._id, providerJobId: data.video_id });
        submitted += 1;
      } catch (error) {
        const typed = error as Error & { retryable?: boolean; code?: string };
        await ctx.runMutation(internal.pipeline.avatar.jobs.markAvatarFailure, {
          jobId: job._id,
          error: { code: typed.code ?? "heygen_submit_failed", message: typed.message, retryable: typed.retryable ?? true },
          incrementAttempt: true,
        });
      }
    }
    if (jobs.length === 8) {
      await ctx.scheduler.runAfter(
        1000,
        internal.pipeline.avatar.heygen.dispatchQueuedAvatarJobs,
        { runId: args.runId }
      );
    }
    if (submitted > 0) {
      await ctx.scheduler.runAfter(
        10_000,
        internal.pipeline.avatar.heygen.pollAvatarJobs,
        { runId: args.runId }
      );
    }
    return { submitted, failed: jobs.length - submitted };
  },
});

export const pollAvatarJobs = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<{ pending: number; completed: number; failed: number }> => {
    const jobs = await ctx.runQuery(internal.pipeline.avatar.jobs.listActiveAvatarJobs, {
      runId: args.runId,
    });
    let pending = 0;
    let completed = 0;
    let failed = 0;
    for (const job of jobs) {
      if (!job.providerJobId) continue;
      const data = (await heyGenJson(
        `/videos/${encodeURIComponent(job.providerJobId)}`
      )) as {
        status?: string;
        video_url?: string | null;
        failure_code?: string | null;
      } | undefined;
      if (data?.status === "completed" && data.video_url) {
        await ctx.runAction(internal.pipeline.avatar.heygen.ingestCompletedAvatarVideo, {
          providerJobId: job.providerJobId,
          url: data.video_url,
        });
        completed += 1;
      } else if (data?.status === "failed") {
        const code = data.failure_code ?? "heygen_generation_failed";
        await ctx.runMutation(internal.pipeline.avatar.jobs.markAvatarFailure, {
          jobId: job._id,
          error: {
            code,
            message: "HeyGen reported that avatar generation failed",
            retryable: code === "HTTP_DOWNLOAD_FAILED" || code === "INTERNAL_ERROR",
          },
        });
        failed += 1;
      } else {
        pending += 1;
      }
    }
    if (pending > 0) {
      await ctx.scheduler.runAfter(15_000, internal.pipeline.avatar.heygen.pollAvatarJobs, {
        runId: args.runId,
      });
    }
    return { pending, completed, failed };
  },
});

/** Download a completed provider video before HeyGen's short-lived URL expires. */
export const ingestCompletedAvatarVideo = internalAction({
  args: { providerJobId: v.string(), url: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.pipeline.avatar.jobs.getAvatarJobByProviderId, { providerJobId: args.providerJobId });
    if (!job || job.status === "succeeded" || job.status === "cancelled") return null;
    try {
      const [detail, videoResponse] = await Promise.all([
        heyGenJson(`/videos/${encodeURIComponent(args.providerJobId)}`) as Promise<{ duration?: number }>,
        fetch(args.url),
      ]);
      if (!videoResponse.ok) throw new Error(`HeyGen video download failed (HTTP ${videoResponse.status})`);
      const bytes = new Uint8Array(await videoResponse.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const objectKey = `sha256/${sha256}.mp4`;
      await putObjectIfAbsent(createObjectStoreClient(), objectKey, bytes, "video/mp4");
      await ctx.runMutation(internal.pipeline.avatar.jobs.completeAvatarJob, {
        jobId: job._id,
        output: {
          objectKey,
          sha256,
          sizeBytes: bytes.byteLength,
          durationMs: Math.max(1, Math.round((detail.duration ?? 0) * 1000)),
          width: 1080,
          height: 1920,
        },
      });
      return { objectKey };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.pipeline.avatar.jobs.markAvatarFailure, {
        jobId: job._id,
        error: { code: "heygen_ingest_failed", message, retryable: true },
      });
      return null;
    }
  },
});
