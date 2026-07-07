import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { conversionCallbackSchema } from "@counseliq/course-schema";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyHmacHex, SIGNATURE_HEADER } from "./pipeline/hmac";

const http = httpRouter();

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

export default http;
