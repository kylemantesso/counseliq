import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { ZodType } from "zod";
import {
  assetIngestRequestSchema,
  convertRequestSchema,
} from "@counseliq/course-schema";
import type { ConverterConfig } from "./config";
import { deliverCallback, runConversion } from "./convert";
import { verifySignature, SIGNATURE_HEADER } from "./hmac";
import { runAssetIngest } from "./media";
import { ObjectStore } from "./store";

/**
 * The converter is deliberately dumb: it accepts a signed request, does the
 * work, and posts a signed manifest to the callback URL. No business logic,
 * no Convex knowledge beyond that URL.
 */
export function createServer(config: ConverterConfig): FastifyInstance {
  const app = Fastify({ logger: true });
  const store = new ObjectStore(config.store);

  // Keep the raw body string so HMAC verification covers exact bytes.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    }
  );

  // Jobs run sequentially: LibreOffice/ffmpeg are memory-hungry and the Fly
  // machine is small; a simple promise chain is enough of a queue.
  let queue: Promise<void> = Promise.resolve();

  /** Shared verify → parse → 202 → queue shape for every job endpoint. */
  function acceptJob<T extends { jobId: string; callbackUrl: string }>(
    rawBody: unknown,
    signature: unknown,
    reply: FastifyReply,
    schema: ZodType<T>,
    label: string,
    work: (job: T) => Promise<Record<string, unknown>>
  ) {
    if (
      typeof rawBody !== "string" ||
      typeof signature !== "string" ||
      !verifySignature(rawBody, signature, config.callbackSecret)
    ) {
      return reply.status(401).send({ error: "invalid signature" });
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return reply.status(400).send({ error: "invalid JSON" });
    }
    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "invalid request", issues: parsed.error.issues });
    }
    const job = parsed.data;

    queue = queue.then(async () => {
      const started = Date.now();
      app.log.info({ jobId: job.jobId }, `${label} started`);
      try {
        const payload = await work(job);
        await deliverCallback(job.callbackUrl, payload, config.callbackSecret);
        app.log.info(
          { jobId: job.jobId, elapsedMs: Date.now() - started },
          `${label} complete, callback delivered`
        );
      } catch (error) {
        app.log.error({ jobId: job.jobId, err: error }, `${label} failed`);
      }
    });

    return reply.status(202).send({ accepted: true, jobId: job.jobId });
  }

  app.get("/health", async () => ({ ok: true }));

  app.post("/convert", async (request, reply) =>
    acceptJob(
      request.body,
      request.headers[SIGNATURE_HEADER],
      reply,
      convertRequestSchema,
      "conversion",
      async (job) => {
        const manifest = await runConversion(job, store);
        return { jobId: job.jobId, manifest };
      }
    )
  );

  app.post("/ingest-assets", async (request, reply) =>
    acceptJob(
      request.body,
      request.headers[SIGNATURE_HEADER],
      reply,
      assetIngestRequestSchema,
      "asset ingest",
      async (job) => {
        const manifest = await runAssetIngest(job, store, config.media);
        return { jobId: job.jobId, manifest };
      }
    )
  );

  return app;
}
