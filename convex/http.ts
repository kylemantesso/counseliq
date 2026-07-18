import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import {
  assetIngestCallbackSchema,
  conversionCallbackSchema,
  pdfImagesCallbackSchema,
  renderCallbackSchema,
} from "@counseliq/course-schema";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyHmacHex, SIGNATURE_HEADER } from "./pipeline/hmac";

const http = httpRouter();

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Conversion completion callback from services/converter. HMAC-verified,
 * manifest validated against the shared contract, then applied idempotently
 * (re-delivered callbacks must not duplicate slides/assets).
 */
http.route({
  path: "/converter/callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CONVERTER_CALLBACK_SECRET;
    if (!secret) {
      console.error("[ingestion] CONVERTER_CALLBACK_SECRET not configured");
      return new Response(JSON.stringify({ error: "not configured" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const rawBody = await request.text();
    const signature = request.headers.get(SIGNATURE_HEADER);
    if (!(await verifyHmacHex(rawBody, signature, secret))) {
      return new Response(JSON.stringify({ error: "invalid signature" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const parsed = conversionCallbackSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          error: "invalid manifest",
          issues: parsed.error.issues,
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    try {
      await ctx.runMutation(
        internal.pipeline.ingestion.applyConversionManifest,
        {
          sourceDocId: parsed.data.jobId,
          manifest: parsed.data.manifest,
        }
      );
    } catch (error) {
      if (
        error instanceof ConvexError &&
        (error.data as { code?: string })?.code === "SOURCE_DOC_NOT_FOUND"
      ) {
        return new Response(JSON.stringify({ error: "unknown jobId" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      throw error;
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
});

/** HeyGen sends signed, retryable completion events for asynchronous avatar video jobs. */
http.route({
  path: "/heygen/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.HEYGEN_WEBHOOK_SECRET;
    if (!secret) return jsonResponse(500, { error: "not configured" });
    const timestamp = Number(request.headers.get("heygen-timestamp"));
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
      return jsonResponse(400, { error: "stale event" });
    }
    const rawBody = await request.text();
    if (!(await verifyHmacHex(rawBody, request.headers.get("heygen-signature"), secret))) {
      return jsonResponse(401, { error: "invalid signature" });
    }
    const eventId = request.headers.get("heygen-event-id");
    if (!eventId) return jsonResponse(400, { error: "missing event id" });
    const firstDelivery = await ctx.runMutation(internal.pipeline.avatar.jobs.recordWebhookEvent, { eventId });
    if (!firstDelivery) return jsonResponse(200, { ok: true, duplicate: true });
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return jsonResponse(400, { error: "invalid JSON" });
    }
    const body = event as { event_type?: unknown; event_data?: { video_id?: unknown; url?: unknown } };
    if (body.event_type === "avatar_video.success" && typeof body.event_data?.video_id === "string" && typeof body.event_data.url === "string") {
      await ctx.scheduler.runAfter(0, internal.pipeline.avatar.heygen.ingestCompletedAvatarVideo, {
        providerJobId: body.event_data.video_id,
        url: body.event_data.url,
      });
    } else if (body.event_type === "avatar_video.fail" && typeof body.event_data?.video_id === "string") {
      const job = await ctx.runQuery(internal.pipeline.avatar.jobs.getAvatarJobByProviderId, {
        providerJobId: body.event_data.video_id,
      });
      if (job) {
        await ctx.runMutation(internal.pipeline.avatar.jobs.markAvatarFailure, {
          jobId: job._id,
          error: { code: "heygen_generation_failed", message: "HeyGen could not generate this avatar video", retryable: true },
        });
      }
    }
    return jsonResponse(200, { ok: true });
  }),
});

/**
 * Asset-ingest completion callback (M6). Same HMAC + shared-contract
 * validation discipline as /converter/callback; applied idempotently.
 */
http.route({
  path: "/converter/asset-callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CONVERTER_CALLBACK_SECRET;
    if (!secret) {
      console.error("[assets] CONVERTER_CALLBACK_SECRET not configured");
      return jsonResponse(500, { error: "not configured" });
    }

    const rawBody = await request.text();
    const signature = request.headers.get(SIGNATURE_HEADER);
    if (!(await verifyHmacHex(rawBody, signature, secret))) {
      return jsonResponse(401, { error: "invalid signature" });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return jsonResponse(400, { error: "invalid JSON" });
    }

    const parsed = assetIngestCallbackSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return jsonResponse(400, {
        error: "invalid manifest",
        issues: parsed.error.issues,
      });
    }

    try {
      await ctx.runMutation(internal.pipeline.assetsIngest.applyAssetManifest, {
        jobId: parsed.data.jobId,
        manifest: parsed.data.manifest,
      });
    } catch (error) {
      if (
        error instanceof ConvexError &&
        (error.data as { code?: string })?.code === "ASSET_JOB_NOT_FOUND"
      ) {
        return jsonResponse(404, { error: "unknown jobId" });
      }
      throw error;
    }

    return jsonResponse(200, { ok: true });
  }),
});

/** Retroactive pdf embedded-image extraction callback (M6). */
http.route({
  path: "/converter/pdf-images-callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CONVERTER_CALLBACK_SECRET;
    if (!secret) {
      console.error("[assets] CONVERTER_CALLBACK_SECRET not configured");
      return jsonResponse(500, { error: "not configured" });
    }

    const rawBody = await request.text();
    const signature = request.headers.get(SIGNATURE_HEADER);
    if (!(await verifyHmacHex(rawBody, signature, secret))) {
      return jsonResponse(401, { error: "invalid signature" });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return jsonResponse(400, { error: "invalid JSON" });
    }

    const parsed = pdfImagesCallbackSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return jsonResponse(400, {
        error: "invalid manifest",
        issues: parsed.error.issues,
      });
    }

    try {
      await ctx.runMutation(
        internal.pipeline.assetsIngest.applyPdfImagesManifest,
        { jobId: parsed.data.jobId, manifest: parsed.data.manifest }
      );
    } catch (error) {
      if (
        error instanceof ConvexError &&
        (error.data as { code?: string })?.code === "SOURCE_DOC_NOT_FOUND"
      ) {
        return jsonResponse(404, { error: "unknown jobId" });
      }
      throw error;
    }

    return jsonResponse(200, { ok: true });
  }),
});

/** Render completion callback from services/renderer. */
http.route({
  path: "/renderer/callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.RENDERER_CALLBACK_SECRET;
    if (!secret) {
      console.error("[render] RENDERER_CALLBACK_SECRET not configured");
      return jsonResponse(500, { error: "not configured" });
    }

    const rawBody = await request.text();
    const signature = request.headers.get(SIGNATURE_HEADER);
    if (!(await verifyHmacHex(rawBody, signature, secret))) {
      return jsonResponse(401, { error: "invalid signature" });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return jsonResponse(400, { error: "invalid JSON" });
    }

    const parsed = renderCallbackSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return jsonResponse(400, {
        error: "invalid callback",
        issues: parsed.error.issues,
      });
    }

    try {
      await ctx.runMutation(internal.pipeline.render.applyRenderCallback, {
        jobId: parsed.data.jobId,
        status: parsed.data.status,
        ...(parsed.data.output !== undefined ? { output: parsed.data.output } : {}),
        ...(parsed.data.error !== undefined ? { error: parsed.data.error } : {}),
      });
    } catch (error) {
      if (
        error instanceof ConvexError &&
        (error.data as { code?: string })?.code === "RENDER_JOB_NOT_FOUND"
      ) {
        return jsonResponse(404, { error: "unknown jobId" });
      }
      throw error;
    }

    return jsonResponse(200, { ok: true });
  }),
});

export default http;
