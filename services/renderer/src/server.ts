import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z, type ZodType } from "zod";
import {
  renderCallbackSchema,
  renderJobRequestSchema,
  type RenderJobRequest,
} from "@counseliq/course-schema";
import type { RendererConfig } from "./config";
import { SIGNATURE_HEADER, signBody, verifySignature } from "./hmac";
import { renderFailure, runRenderJob } from "./render-job";
import { ObjectStore } from "./store";

async function deliverCallback(
  callbackUrl: string,
  body: unknown,
  secret: string
): Promise<void> {
  const json = JSON.stringify(body);
  const signature = signBody(json, secret);
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: signature,
    },
    body: json,
  });
  if (!response.ok) {
    throw new Error(`callback failed with HTTP ${response.status}`);
  }
}

function parseSignedBody<T>(
  rawBody: unknown,
  signature: unknown,
  secret: string,
  schema: ZodType<T>
): { ok: true; value: T } | { ok: false; status: number; body: Record<string, unknown> } {
  if (
    typeof rawBody !== "string" ||
    typeof signature !== "string" ||
    !verifySignature(rawBody, signature, secret)
  ) {
    return { ok: false, status: 401, body: { error: "invalid signature" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, body: { error: "invalid JSON" } };
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      status: 400,
      body: { error: "invalid request", issues: validated.error.issues },
    };
  }

  return { ok: true, value: validated.data };
}

export function createServer(config: RendererConfig): FastifyInstance {
  const app = Fastify({ logger: true });
  const store = new ObjectStore(config.store);

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    }
  );

  let queue: Promise<void> = Promise.resolve();
  const cancelledJobIds = new Set<string>();
  let activeJobId: string | null = null;
  let queuedJobs = 0;

  app.get("/health", async () => ({
    ok: true,
    rendererVersion: config.rendererVersion,
    activeJobId,
    queuedJobs,
  }));

  app.post("/cancel", async (request, reply: FastifyReply) => {
    const parsed = parseSignedBody(
      request.body,
      request.headers[SIGNATURE_HEADER],
      config.callbackSecret,
      z.object({ jobId: z.string().min(1) }).strict()
    );
    if (!parsed.ok) {
      return reply.status(parsed.status).send(parsed.body);
    }

    cancelledJobIds.add(parsed.value.jobId);
    return reply.send({
      cancelled: true,
      active: activeJobId === parsed.value.jobId,
    });
  });

  app.post("/render", async (request, reply: FastifyReply) => {
    const parsed = parseSignedBody(
      request.body,
      request.headers[SIGNATURE_HEADER],
      config.callbackSecret,
      renderJobRequestSchema
    );
    if (!parsed.ok) {
      return reply.status(parsed.status).send(parsed.body);
    }

    const job: RenderJobRequest = parsed.value;
    queuedJobs += 1;
    queue = queue.then(async () => {
      try {
        if (cancelledJobIds.delete(job.jobId)) {
          app.log.info({ jobId: job.jobId }, "render cancelled before start");
          return;
        }

        const startedAt = Date.now();
        activeJobId = job.jobId;
        app.log.info({ jobId: job.jobId }, "render started");
        const output = await runRenderJob(job, store, config);
        const callback = renderCallbackSchema.parse({
          jobId: job.jobId,
          status: "succeeded",
          output,
        });
        await deliverCallback(job.callbackUrl, callback, config.callbackSecret);
        app.log.info(
          { jobId: job.jobId, elapsedMs: Date.now() - startedAt },
          "render complete"
        );
      } catch (error) {
        const failure = renderFailure(error);
        const callback = renderCallbackSchema.parse({
          jobId: job.jobId,
          status: "failed",
          error: failure,
        });
        try {
          await deliverCallback(job.callbackUrl, callback, config.callbackSecret);
        } catch (callbackError) {
          app.log.error(
            {
              jobId: job.jobId,
              err: callbackError,
            },
            "render failed and callback delivery failed"
          );
        }
        app.log.error({ jobId: job.jobId, err: error }, "render failed");
      } finally {
        activeJobId = null;
        cancelledJobIds.delete(job.jobId);
        queuedJobs -= 1;
      }
    });

    return reply.status(202).send({ accepted: true, jobId: job.jobId });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "invalid request", issues: error.issues });
    }
    return reply.status(500).send({ error: "internal_error" });
  });

  return app;
}
