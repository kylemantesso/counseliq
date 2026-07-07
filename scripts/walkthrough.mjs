#!/usr/bin/env node

/**
 * Pipeline exit test: drive a run end-to-end against the dev deployment,
 * with REAL ingestion (M2) and REAL LLM extraction (M3).
 *
 * 1. Upload both fixture docs (presigned PUT) from
 *    packages/course-schema/fixtures/ingestion/doc-{a,b}.(pptx|pdf)
 * 2. registerSourceDoc x 2, startRun (docs linked to the run)
 * 3. Watch CONVERTING -> CONVERTED with per-doc progress
 * 4. Watch EXTRACTING -> EXTRACTED (real LLM extraction; running cost printed)
 * 5. Resolve every gate-1 flagged-fact item, then approve gates to PUBLISHED
 * 6. Print inventory counts, cost breakdown, provenance + theme summary
 *
 * Usage:
 *   npm run walkthrough                — full run (requires fixture docs,
 *                                        object store + converter configured)
 *   npm run walkthrough -- --skip-docs — M1-style run with no source docs
 *                                        (conversion phase no-ops through)
 *
 * Requires `npx convex dev` to have been run once so the project is linked
 * to a dev deployment.
 */

import { spawn } from "child_process";
import { createHash } from "crypto";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(
  ROOT,
  "packages/course-schema/fixtures/ingestion"
);

const SKIP_DOCS = process.argv.includes("--skip-docs");

const GATE_STATES = {
  GATE_1_KNOWLEDGE_REVIEW: 1,
  GATE_2_QUIZ_REVIEW: 2,
  GATE_3_PREVIEW: 3,
};

const CONTENT_TYPES = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
};

const POLL_INTERVAL_MS = 1000;
const TIMEOUT_MS = 10 * 60 * 1000;

function convexRun(functionPath, args = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["convex", "run", functionPath, JSON.stringify(args)],
      { cwd: ROOT, shell: false, env: process.env }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(`convex run ${functionPath} failed (${code}):\n${stderr}`)
        );
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch {
        reject(
          new Error(
            `convex run ${functionPath} returned unparseable output:\n${trimmed}`
          )
        );
      }
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatEvent(event, index) {
  const detail = event.detail ? ` — ${event.detail}` : "";
  const at = new Date(event._creationTime).toISOString();
  return `  ${String(index + 1).padStart(2)}. [${at}] ${event.fromState} -> ${event.toState} (${event.actor})${detail}`;
}

/** Locate doc-a.* and doc-b.* fixture files (pptx or pdf). */
function findFixtureDocs() {
  let entries;
  try {
    entries = readdirSync(FIXTURES_DIR);
  } catch {
    entries = [];
  }
  const docs = [];
  for (const name of ["doc-a", "doc-b"]) {
    const match = entries.find(
      (f) => f === `${name}.pptx` || f === `${name}.pdf`
    );
    if (match) {
      docs.push({
        name: match,
        filePath: path.join(FIXTURES_DIR, match),
        kind: match.endsWith(".pptx") ? "pptx" : "pdf",
      });
    }
  }
  return docs;
}

async function uploadDoc(doc) {
  const bytes = readFileSync(doc.filePath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = `sha256/${hash}.${doc.kind}`;
  const contentType = CONTENT_TYPES[doc.kind];

  const { url } = await convexRun("pipeline/objectStore:presignPut", {
    key,
    contentType,
  });

  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(`Upload of ${doc.name} failed: ${response.status}`);
  }

  return { ...doc, key, sizeKb: Math.round(bytes.length / 1024) };
}

async function printDocSummaries(sourceDocIds, docNamesById) {
  console.log("\nIngestion summary:");
  for (const sourceDocId of sourceDocIds) {
    const slides = await convexRun("pipeline/ingestion:listSlidesForDoc", {
      sourceDocId,
    });
    const name = docNamesById.get(sourceDocId) ?? sourceDocId;
    console.log(`\n  ${name} (${sourceDocId})`);
    console.log(`    pages: ${slides.length}`);
    const first = slides.find((s) => s.n === 1);
    if (first) {
      console.log(`    page 1 provenance: ${first.provenanceId}`);
      console.log(`    page 1 pngKey:     ${first.pngKey}`);
      console.log(`    page 1 thumbKey:   ${first.thumbKey}`);
    }
  }
}

async function main() {
  console.log("== CounselIQ M2 walkthrough ==\n");

  console.log("Seeding institution…");
  const institutionId = await convexRun("pipeline/seed:seed");
  console.log(`  institution: ${institutionId}`);

  const sourceDocIds = [];
  const docNamesById = new Map();
  const docThemes = new Map();

  if (SKIP_DOCS) {
    console.log("\n--skip-docs: starting a run with no source documents.");
  } else {
    const fixtures = findFixtureDocs();
    if (fixtures.length < 2) {
      console.error(
        `\nMissing ingestion fixtures. Place two real source documents at:\n` +
          `  packages/course-schema/fixtures/ingestion/doc-a.(pptx|pdf)\n` +
          `  packages/course-schema/fixtures/ingestion/doc-b.(pptx|pdf)\n` +
          `(e.g. one text-dense deck, one image-heavy or tabular pdf), or run\n` +
          `with --skip-docs for the stubbed M1-style walkthrough.`
      );
      process.exit(1);
    }

    console.log("\nUploading fixture docs…");
    for (const fixture of fixtures) {
      const uploaded = await uploadDoc(fixture);
      console.log(
        `  uploaded ${uploaded.name} (${uploaded.sizeKb} KB) -> ${uploaded.key}`
      );
      const sourceDocId = await convexRun("pipeline/ingestion:registerSourceDoc", {
        institutionId,
        objectKey: uploaded.key,
        kind: uploaded.kind,
      });
      console.log(`  registered sourceDoc: ${sourceDocId}`);
      sourceDocIds.push(sourceDocId);
      docNamesById.set(sourceDocId, uploaded.name);
    }
  }

  console.log("\nStarting run…");
  const runId = await convexRun("pipeline/runs:startRun", {
    institutionId,
    ...(sourceDocIds.length > 0 ? { sourceDocIds } : {}),
  });
  console.log(`  run: ${runId}\n`);

  const decidedGates = new Set();
  const docStatuses = new Map();
  let lastState = null;
  let lastCostPrinted = 0;
  const startedAt = Date.now();

  for (;;) {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      throw new Error(
        `Timed out after ${TIMEOUT_MS / 1000}s (last state: ${lastState})`
      );
    }

    const { run, events } = await convexRun("pipeline/queries:getRunInternal", {
      runId,
    });
    if (!run) {
      throw new Error("Run disappeared mid-walkthrough");
    }

    if (run.state !== lastState) {
      console.log(`state: ${run.state}`);
      lastState = run.state;
    }

    // Per-doc conversion progress while the converter works.
    if (run.state === "CONVERTING" && sourceDocIds.length > 0) {
      const docs = await convexRun("pipeline/ingestion:listSourceDocsForRun", {
        runId,
      });
      for (const doc of docs) {
        if (docStatuses.get(doc._id) !== doc.status) {
          docStatuses.set(doc._id, doc.status);
          const name = docNamesById.get(doc._id) ?? doc._id;
          const pages =
            doc.pageCount !== undefined ? ` (${doc.pageCount} pages)` : "";
          console.log(`  doc ${name}: ${doc.status}${pages}`);
        }
        if (doc.status === "converted" && !docThemes.has(doc._id)) {
          docThemes.set(doc._id, doc.theme ?? null);
        }
      }
    }

    // Running LLM cost while extraction is live.
    if (run.state === "EXTRACTING") {
      const cost = await convexRun("pipeline/llmCalls:getRunCostInternal", {
        runId,
      });
      if (cost.totalCalls > 0 && cost.totalUsd !== lastCostPrinted) {
        lastCostPrinted = cost.totalUsd;
        console.log(
          `  extraction cost so far: $${cost.totalUsd.toFixed(4)} (${cost.totalCalls} calls)`
        );
      }
    }

    if (run.state === "FAILED") {
      console.error(`\nRun FAILED: ${JSON.stringify(run.error)}`);
      process.exit(1);
    }

    if (run.state === "PUBLISHED") {
      console.log("\nRun PUBLISHED. Full runEvents history:");
      for (const [index, event] of events.entries()) {
        console.log(formatEvent(event, index));
      }
      console.log(`\nWalkthrough complete: ${events.length} transitions.`);

      if (sourceDocIds.length > 0) {
        await printDocSummaries(sourceDocIds, docNamesById);

        console.log("\nTheme candidates:");
        const finalDocs = await convexRun(
          "pipeline/ingestion:listSourceDocsForRun",
          { runId }
        );
        for (const doc of finalDocs) {
          const name = docNamesById.get(doc._id) ?? doc._id;
          const theme = doc.theme;
          if (!theme) {
            console.log(`  ${name}: none (pdf-native or not extracted)`);
          } else {
            console.log(
              `  ${name}: [${theme.method ?? "ooxml"}] colors [${theme.colors.join(", ")}], fonts [${theme.fonts.join(", ")}], ${theme.logoCandidates.length} logo candidate(s)`
            );
          }
        }
      }

      // M3: inventory + cost summary.
      const inventory = await convexRun(
        "pipeline/inventory:listInventoryForRun",
        { runId }
      );
      const byKind = new Map();
      let flagged = 0;
      for (const item of inventory) {
        byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
        if (item.flagged) flagged += 1;
      }
      console.log("\nKnowledge inventory:");
      console.log(
        `  ${inventory.length} items — ` +
          `${byKind.get("concept") ?? 0} concepts, ${byKind.get("fact") ?? 0} facts, ` +
          `${byKind.get("entity") ?? 0} entities, ${byKind.get("quote") ?? 0} quotes ` +
          `(${flagged} flagged at extraction)`
      );

      const cost = await convexRun("pipeline/llmCalls:getRunCostInternal", {
        runId,
      });
      console.log("\nLLM cost:");
      console.log(
        `  total: $${cost.totalUsd.toFixed(4)} across ${cost.totalCalls} calls ` +
          `(${cost.totalTokensIn} in / ${cost.totalTokensOut} out tokens)`
      );
      for (const row of cost.byStage) {
        console.log(
          `    ${row.stage} [${row.model}]: $${row.costUsd.toFixed(4)} over ${row.calls} call(s)`
        );
      }
      const docCount = sourceDocIds.length || 1;
      console.log(`  $/doc: $${(cost.totalUsd / docCount).toFixed(4)}`);
      return;
    }

    const gate = GATE_STATES[run.state];
    if (gate && !decidedGates.has(gate)) {
      decidedGates.add(gate);

      // Gate 1 (M3): every flagged-fact item must be individually resolved
      // before the gate can be approved. The walkthrough auto-approves each
      // with a placeholder source so the pipeline can proceed to the stubs.
      if (gate === 1) {
        const items = await convexRun(
          "pipeline/reviewItems:listReviewItemsForRun",
          { runId, gate: 1 }
        );
        const pending = items.filter((item) => item.status === "pending");
        console.log(
          `  gate 1: ${items.length} flagged-fact item(s), resolving ${pending.length}…`
        );
        for (const item of pending) {
          await convexRun("pipeline/reviewItems:resolveReviewItem", {
            reviewItemId: item._id,
            resolution: "approve",
            sourceLabel: "walkthrough-auto",
            year: new Date().getFullYear(),
            reviewer: "walkthrough-script",
          });
        }
      }

      console.log(`  approving gate ${gate}…`);
      await convexRun("pipeline/runs:decideGate", {
        runId,
        gate,
        decision: "approve",
        reviewer: "walkthrough-script",
      });
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
