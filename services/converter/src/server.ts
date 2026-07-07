import Fastify, { type FastifyInstance } from "fastify";
import { convertRequestSchema } from "@counseliq/course-schema";
import type { ConverterConfig } from "./config";
import { deliverCallback, runConversion } from "./convert";
import { verifySignature, SIGNATURE_HEADER } from "./hmac";
import { ObjectStore } from "./store";

/**
 * The converter is deliberately dumb: it accepts a signed /convert request,
 * does the conversion, and posts a signed manifest to the callback URL. No
 * business logic, no Convex knowledge beyond that URL.
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

  // Jobs run sequentially: LibreOffice is memory-hungry and the Fly machine
  // is small; a simple promise chain is enough of a queue.
  let queue: Promise<void> = Promise.resolve();

  app.get("/health", async () => ({ ok: true }));

  app.post("/convert", async (request, reply) => {
    const rawBody = request.body as string;
    const signature = request.headers[SIGNATURE_HEADER];
    if (
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
    const parsed = convertRequestSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "invalid request", issues: parsed.error.issues });
    }
    const job = parsed.data;

    queue = queue.then(async () => {
      const started = Date.now();
      app.log.info({ jobId: job.jobId, kind: job.kind }, "conversion started");
      try {
        const manifest = await runConversion(job, store);
        await deliverCallback(
          job.callbackUrl,
          job.jobId,
          manifest,
          config.callbackSecret
        );
        app.log.info(
          {
            jobId: job.jobId,
            pageCount: manifest.pageCount,
            elapsedMs: Date.now() - started,
          },
          "conversion complete, callback delivered"
        );
      } catch (error) {
        app.log.error({ jobId: job.jobId, err: error }, "conversion failed");
      }
    });

    return reply.status(202).send({ accepted: true, jobId: job.jobId });
  });

  return app;
}
