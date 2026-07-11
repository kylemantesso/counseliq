/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { hmacSha256Hex, SIGNATURE_HEADER } from "./pipeline/hmac";

const modules = import.meta.glob("./**/*.ts");

const SECRET = "test-callback-secret";

beforeEach(() => {
  process.env.CONVERTER_CALLBACK_SECRET = SECRET;
  delete process.env.CONVERTER_URL;
  delete process.env.CONVERTER_CALLBACK_URL;
  delete process.env.CONVEX_SITE_URL;
  delete process.env.CONVERTER_TIMEOUT_MS;
});

const HASH_DOC = "1".repeat(64);
const KEY_PNG_1 = `sha256/${"2".repeat(64)}.png`;
const KEY_THUMB_1 = `sha256/${"3".repeat(64)}.png`;
const KEY_PNG_2 = `sha256/${"4".repeat(64)}.png`;
const KEY_THUMB_2 = `sha256/${"5".repeat(64)}.png`;
const KEY_IMAGE = `sha256/${"6".repeat(64)}.jpeg`;

function validManifest() {
  return {
    sourceDocHash: HASH_DOC,
    pageCount: 2,
    pages: [
      {
        n: 1,
        pngKey: KEY_PNG_1,
        thumbKey: KEY_THUMB_1,
        text: "Page one text",
        notes: "Presenter notes",
        embeddedImages: [{ key: KEY_IMAGE, width: 640, height: 480 }],
      },
      {
        n: 2,
        pngKey: KEY_PNG_2,
        thumbKey: KEY_THUMB_2,
        text: "Page two text",
        notes: "",
        embeddedImages: [],
      },
    ],
  };
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "Test University",
      brandTokens: {},
      pronunciationLexicon: {},
      market: "AU",
    });
    const runId = await ctx.db.insert("runs", {
      institutionId,
      state: "CONVERTING",
      promptVersions: {},
    });
    const sourceDocId = await ctx.db.insert("sourceDocs", {
      institutionId,
      runId,
      kind: "pptx",
      objectKey: `sha256/${"a".repeat(64)}.pptx`,
      status: "converting",
    });
    return { institutionId, runId, sourceDocId };
  });
  return { t, ...ids };
}

async function setupStandaloneDoc(status: "pending" | "converting" | "converted") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "Standalone University",
      brandTokens: {},
      pronunciationLexicon: {},
      market: "AU",
    });
    const sourceDocId = await ctx.db.insert("sourceDocs", {
      institutionId,
      kind: "pdf",
      objectKey: `sha256/${"f".repeat(64)}.pdf`,
      status,
    });
    return { institutionId, sourceDocId };
  });
  return { t, ...ids };
}

async function postCallback(
  t: ReturnType<typeof convexTest>,
  body: string,
  signature?: string
) {
  return t.fetch("/converter/callback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: signature ?? (await hmacSha256Hex(body, SECRET)),
    },
    body,
  });
}

describe("/converter/callback", () => {
  test("rejects a bad HMAC signature with 401 and writes nothing", async () => {
    const { t, sourceDocId } = await setup();
    const body = JSON.stringify({
      jobId: sourceDocId,
      manifest: validManifest(),
    });

    const response = await postCallback(t, body, "0".repeat(64));
    expect(response.status).toBe(401);

    const slides = await t.run(async (ctx) => ctx.db.query("slides").take(10));
    expect(slides).toHaveLength(0);
  });

  test("rejects an invalid manifest with 400", async () => {
    const { t, sourceDocId } = await setup();
    const manifest = validManifest();
    // Violate the contract: pageCount disagrees with pages length.
    manifest.pageCount = 5;
    const body = JSON.stringify({ jobId: sourceDocId, manifest });

    const response = await postCallback(t, body);
    expect(response.status).toBe(400);

    const slides = await t.run(async (ctx) => ctx.db.query("slides").take(10));
    expect(slides).toHaveLength(0);
  });

  test("rejects a non-content-addressed object key with 400", async () => {
    const { t, sourceDocId } = await setup();
    const manifest = validManifest();
    manifest.pages[0].pngKey = "uploads/page-1.png";
    const body = JSON.stringify({ jobId: sourceDocId, manifest });

    const response = await postCallback(t, body);
    expect(response.status).toBe(400);
  });

  test("returns 404 for an unknown jobId", async () => {
    const { t } = await setup();
    const body = JSON.stringify({
      jobId: "not-a-real-id",
      manifest: validManifest(),
    });

    const response = await postCallback(t, body);
    expect(response.status).toBe(404);
  });

  test("happy path writes N slides with provenance and transitions the run", async () => {
    const { t, runId, sourceDocId } = await setup();
    const body = JSON.stringify({
      jobId: sourceDocId,
      manifest: validManifest(),
    });

    const response = await postCallback(t, body);
    expect(response.status).toBe(200);

    const { slides, doc, run } = await t.run(async (ctx) => ({
      slides: await ctx.db
        .query("slides")
        .withIndex("by_source_doc", (q) =>
          q.eq("sourceDocId", sourceDocId as Id<"sourceDocs">)
        )
        .take(10),
      doc: await ctx.db.get(sourceDocId as Id<"sourceDocs">),
      run: await ctx.db.get(runId as Id<"runs">),
    }));

    expect(slides).toHaveLength(2);
    const first = slides.find((s) => s.n === 1);
    expect(first).toMatchObject({
      pngKey: KEY_PNG_1,
      thumbKey: KEY_THUMB_1,
      text: "Page one text",
      notes: "Presenter notes",
      provenanceId: `doc:${sourceDocId}:page:1`,
      embeddedImages: [{ key: KEY_IMAGE, width: 640, height: 480 }],
    });

    expect(doc?.status).toBe("converted");
    expect(doc?.pageCount).toBe(2);
    expect(doc?.sourceDocHash).toBe(HASH_DOC);

    expect(run?.state).toBe("CONVERTED");
  });

  test("duplicate callback delivery is idempotent", async () => {
    const { t, runId, sourceDocId } = await setup();
    const body = JSON.stringify({
      jobId: sourceDocId,
      manifest: validManifest(),
    });

    expect((await postCallback(t, body)).status).toBe(200);
    const countsAfterFirst = await t.run(async (ctx) => ({
      slides: (await ctx.db.query("slides").take(100)).length,
      assets: (await ctx.db.query("assets").take(100)).length,
      events: (await ctx.db.query("runEvents").take(100)).length,
    }));

    expect((await postCallback(t, body)).status).toBe(200);
    const countsAfterSecond = await t.run(async (ctx) => ({
      slides: (await ctx.db.query("slides").take(100)).length,
      assets: (await ctx.db.query("assets").take(100)).length,
      events: (await ctx.db.query("runEvents").take(100)).length,
    }));

    expect(countsAfterSecond).toEqual(countsAfterFirst);
    const run = await t.run(async (ctx) => ctx.db.get(runId as Id<"runs">));
    expect(run?.state).toBe("CONVERTED");
  });

  test("run only transitions when ALL source docs are converted", async () => {
    const { t, runId, institutionId, sourceDocId } = await setup();
    // Register a second doc on the same run, still converting.
    await t.run(async (ctx) => {
      await ctx.db.insert("sourceDocs", {
        institutionId: institutionId as Id<"institutions">,
        runId: runId as Id<"runs">,
        kind: "pdf",
        objectKey: `sha256/${"b".repeat(64)}.pdf`,
        status: "converting",
      });
    });

    const body = JSON.stringify({
      jobId: sourceDocId,
      manifest: validManifest(),
    });
    expect((await postCallback(t, body)).status).toBe(200);

    const run = await t.run(async (ctx) => ctx.db.get(runId as Id<"runs">));
    expect(run?.state).toBe("CONVERTING");
  });
});

describe("dispatchSourceDocConversion", () => {
  test("marks standalone docs failed when callback URL config is missing", async () => {
    const { t, sourceDocId } = await setupStandaloneDoc("pending");
    process.env.CONVERTER_URL = "https://converter.example";

    await t.action(internal.pipeline.ingestion.dispatchSourceDocConversion, {
      sourceDocId: sourceDocId as Id<"sourceDocs">,
    });

    const doc = await t.run(async (ctx) =>
      ctx.db.get(sourceDocId as Id<"sourceDocs">)
    );
    expect(doc?.status).toBe("failed");
  });
});

describe("markSourceDocFailedIfStillConverting", () => {
  test("fails only docs that are still converting", async () => {
    const converting = await setupStandaloneDoc("converting");
    const converted = await setupStandaloneDoc("converted");

    await converting.t.mutation(
      internal.pipeline.ingestion.markSourceDocFailedIfStillConverting,
      { sourceDocId: converting.sourceDocId as Id<"sourceDocs"> }
    );
    await converted.t.mutation(
      internal.pipeline.ingestion.markSourceDocFailedIfStillConverting,
      { sourceDocId: converted.sourceDocId as Id<"sourceDocs"> }
    );

    const convertingAfter = await converting.t.run(async (ctx) =>
      ctx.db.get(converting.sourceDocId as Id<"sourceDocs">)
    );
    const convertedAfter = await converted.t.run(async (ctx) =>
      ctx.db.get(converted.sourceDocId as Id<"sourceDocs">)
    );

    expect(convertingAfter?.status).toBe("failed");
    expect(convertedAfter?.status).toBe("converted");
  });
});

describe("registerSourceDoc", () => {
  // startRun's doc-linking is covered end-to-end by scripts/walkthrough.mjs
  // (starting the durable workflow requires component registration that
  // convex-test does not have here).
  test("creates pending docs; multiple docs per run are legal", async () => {
    const t = convexTest(schema, modules);
    const institutionId = await t.run(async (ctx) =>
      ctx.db.insert("institutions", {
        name: "Test University",
        brandTokens: {},
        pronunciationLexicon: {},
        market: "AU",
      })
    );

    const docA = await t.mutation(internal.pipeline.ingestion.registerSourceDoc, {
      institutionId,
      objectKey: `sha256/${"a".repeat(64)}.pptx`,
      kind: "pptx",
    });
    const docB = await t.mutation(internal.pipeline.ingestion.registerSourceDoc, {
      institutionId,
      objectKey: `sha256/${"b".repeat(64)}.pdf`,
      kind: "pdf",
    });

    // Link both docs to one run (what startRunHelper does) and list them.
    const runId = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("runs", {
        institutionId,
        state: "UPLOADED",
        promptVersions: {},
      });
      await ctx.db.patch(docA, { runId });
      await ctx.db.patch(docB, { runId });
      return runId;
    });

    const docs = await t.query(
      internal.pipeline.ingestion.listSourceDocsForRun,
      { runId }
    );
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.status === "pending")).toBe(true);
    expect(docs.map((d) => d.kind).sort()).toEqual(["pdf", "pptx"]);
  });

  test("rejects an unknown institution", async () => {
    const t = convexTest(schema, modules);
    const institutionId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("institutions", {
        name: "Doomed",
        brandTokens: {},
        pronunciationLexicon: {},
        market: "AU",
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.mutation(internal.pipeline.ingestion.registerSourceDoc, {
        institutionId,
        objectKey: `sha256/${"a".repeat(64)}.pptx`,
        kind: "pptx",
      })
    ).rejects.toThrow(/INSTITUTION_NOT_FOUND/);
  });
});

describe("conversion hydration fast-path", () => {
  test("hydrates a pending run doc from an existing converted doc with same object key", async () => {
    const t = convexTest(schema, modules);
    const { sourceConvertedId, targetPendingId } = await t.run(async (ctx) => {
      const institutionId = await ctx.db.insert("institutions", {
        name: "Hydration University",
        brandTokens: {},
        pronunciationLexicon: {},
        market: "AU",
      });
      const runId = await ctx.db.insert("runs", {
        institutionId,
        state: "CONVERTING",
        promptVersions: {},
      });

      const sourceConvertedId = await ctx.db.insert("sourceDocs", {
        institutionId,
        kind: "pdf",
        objectKey: `sha256/${"c".repeat(64)}.pdf`,
        status: "converted",
        sourceDocHash: HASH_DOC,
        pageCount: 1,
      });
      await ctx.db.insert("slides", {
        sourceDocId: sourceConvertedId,
        n: 1,
        pngKey: KEY_PNG_1,
        thumbKey: KEY_THUMB_1,
        text: "Hydrated text",
        notes: "Hydrated notes",
        hash: "hash-hydrated",
        provenanceId: `doc:${sourceConvertedId}:page:1`,
        embeddedImages: [],
      });
      await ctx.db.insert("pageExtractions", {
        sourceDocId: sourceConvertedId,
        n: 1,
        cacheKey: "hash-hydrated:extract-page@1:model-x",
        result: {
          provenanceId: `doc:${sourceConvertedId}:page:1`,
          concepts: [],
          facts: [
            {
              type: "fact",
              conceptKey: "employment",
              statement: "Employment rate is 87%",
              claimClass: "statistic",
              provenance: [`doc:${sourceConvertedId}:page:1`],
              sourceLabel: "QILT",
              year: 2024,
              flagged: false,
            },
          ],
          entities: [],
          quotes: [],
        },
      });

      const targetPendingId = await ctx.db.insert("sourceDocs", {
        institutionId,
        runId,
        kind: "pdf",
        objectKey: `sha256/${"c".repeat(64)}.pdf`,
        status: "pending",
      });

      return { sourceConvertedId, targetPendingId };
    });

    const hydrated = await t.mutation(
      internal.pipeline.ingestion.tryHydrateSourceDocFromPriorConversion,
      { sourceDocId: targetPendingId as Id<"sourceDocs"> }
    );
    expect(hydrated).toEqual({ hydrated: true });

    const { targetDoc, targetSlides, targetExtractions } = await t.run(async (ctx) => ({
      targetDoc: await ctx.db.get(targetPendingId as Id<"sourceDocs">),
      targetSlides: await ctx.db
        .query("slides")
        .withIndex("by_source_doc_and_n", (q) =>
          q.eq("sourceDocId", targetPendingId as Id<"sourceDocs">)
        )
        .take(10),
      targetExtractions: await ctx.db
        .query("pageExtractions")
        .withIndex("by_source_doc_and_n", (q) =>
          q.eq("sourceDocId", targetPendingId as Id<"sourceDocs">)
        )
        .take(10),
    }));

    expect(targetDoc?.status).toBe("converted");
    expect(targetDoc?.sourceDocHash).toBe(HASH_DOC);
    expect(targetDoc?.pageCount).toBe(1);
    expect(targetSlides).toHaveLength(1);
    expect(targetSlides[0]).toMatchObject({
      text: "Hydrated text",
      notes: "Hydrated notes",
      pngKey: KEY_PNG_1,
      thumbKey: KEY_THUMB_1,
      provenanceId: `doc:${targetPendingId}:page:1`,
    });
    expect(targetExtractions).toHaveLength(1);
    expect(targetExtractions[0]?.result).toMatchObject({
      provenanceId: `doc:${targetPendingId}:page:1`,
      facts: [
        {
          provenance: [`doc:${targetPendingId}:page:1`],
        },
      ],
    });
    expect(sourceConvertedId).toBeDefined();
  });

  test("dispatchAndAwaitConversions returns converted when hydration resolves every doc", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.run(async (ctx) => {
      const institutionId = await ctx.db.insert("institutions", {
        name: "Hydration Dispatch University",
        brandTokens: {},
        pronunciationLexicon: {},
        market: "AU",
      });
      const runId = await ctx.db.insert("runs", {
        institutionId,
        state: "CONVERTING",
        promptVersions: {},
      });

      const convertedDocId = await ctx.db.insert("sourceDocs", {
        institutionId,
        kind: "pptx",
        objectKey: `sha256/${"d".repeat(64)}.pptx`,
        status: "converted",
        sourceDocHash: HASH_DOC,
        pageCount: 1,
      });
      await ctx.db.insert("slides", {
        sourceDocId: convertedDocId,
        n: 1,
        pngKey: KEY_PNG_1,
        thumbKey: KEY_THUMB_1,
        text: "Converted seed",
        notes: "",
        hash: "hash-seed",
        provenanceId: `doc:${convertedDocId}:page:1`,
        embeddedImages: [],
      });

      await ctx.db.insert("sourceDocs", {
        institutionId,
        runId,
        kind: "pptx",
        objectKey: `sha256/${"d".repeat(64)}.pptx`,
        status: "pending",
      });

      return runId;
    });

    const result = await t.action(internal.pipeline.ingestion.dispatchAndAwaitConversions, {
      runId: runId as Id<"runs">,
    });
    expect(result).toEqual({ status: "converted" });
  });
});
