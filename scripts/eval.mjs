#!/usr/bin/env node

/**
 * M3 extraction eval: runs REAL extraction over the golden fixture docs
 * against a local deployment and scores the resulting knowledge inventory
 * against hand-labelled fixtures.
 *
 *   npm run eval -- --yes            # costs real money (OpenRouter)
 *
 * Scores per fixture (packages/course-schema/fixtures/labels/*.labels.json):
 *   - concept recall     ≥ threshold in eval.config.json (default 0.8)
 *   - flag completeness  100% of known-dirty statistics flagged (any miss fails)
 *   - precision guard    warn when extracted/labelled concept ratio is high
 *   - must-extract entities reported as warnings
 *
 * Prints prompt versions, routed models, and actual vs estimated cost.
 * Appends one JSON line per run to eval-history.jsonl.
 *
 * Prerequisites: `npm run dev:stack` running, OPENROUTER_API_KEY set on the
 * local deployment, labels confirmed by the operator ("confirmed": true) —
 * use --allow-unconfirmed-labels to override while iterating.
 */

import { spawn } from "child_process";
import { createHash } from "crypto";
import { appendFileSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(ROOT, "packages/course-schema/fixtures/ingestion");
const LABELS_DIR = path.join(ROOT, "packages/course-schema/fixtures/labels");
const HISTORY_FILE = path.join(ROOT, "eval-history.jsonl");

const YES = process.argv.includes("--yes");
const ALLOW_UNCONFIRMED = process.argv.includes("--allow-unconfirmed-labels");

const CONFIG = JSON.parse(readFileSync(path.join(ROOT, "eval.config.json"), "utf8"));

const CONTENT_TYPES = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
};

function convexRun(functionPath, args = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["convex", "run", functionPath, JSON.stringify(args)], {
      cwd: ROOT,
      shell: false,
      env: { ...process.env, CONVEX_DEPLOYMENT: CONFIG.deployment },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`convex run ${functionPath} failed (${code}):\n${stderr}`));
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) return resolve(null);
      try {
        resolve(JSON.parse(trimmed));
      } catch {
        reject(new Error(`unparseable output from ${functionPath}:\n${trimmed}`));
      }
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mirrors normalizeConceptTitle in packages/course-schema/src/inventory.ts. */
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lenient title match: substring either way, or token Jaccard >= 0.5. */
function titlesMatch(labelTitle, extractedTitle) {
  const a = normalizeTitle(labelTitle);
  const b = normalizeTitle(extractedTitle);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  const intersection = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return intersection / union >= 0.5;
}

function loadLabels() {
  const labels = [];
  for (const doc of ["doc-a", "doc-b"]) {
    const file = path.join(LABELS_DIR, `${doc}.labels.json`);
    labels.push(JSON.parse(readFileSync(file, "utf8")));
  }
  return labels;
}

function findFixtureDoc(name) {
  for (const ext of ["pptx", "pdf"]) {
    const filePath = path.join(FIXTURES_DIR, `${name}.${ext}`);
    try {
      readFileSync(filePath, { encoding: null, length: 1 });
      return { name: `${name}.${ext}`, filePath, kind: ext };
    } catch {
      // keep looking
    }
  }
  return null;
}

async function uploadDoc(doc) {
  const bytes = readFileSync(doc.filePath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = `sha256/${hash}.${doc.kind}`;
  const { url } = await convexRun("pipeline/objectStore:presignPut", {
    key,
    contentType: CONTENT_TYPES[doc.kind],
  });
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": CONTENT_TYPES[doc.kind] },
    body: bytes,
  });
  if (!response.ok) throw new Error(`upload of ${doc.name} failed: ${response.status}`);
  return key;
}

async function main() {
  console.log("== CounselIQ extraction eval ==\n");

  const labels = loadLabels();
  const unconfirmed = labels.filter((l) => !l.confirmed);
  if (unconfirmed.length > 0) {
    const names = unconfirmed.map((l) => l.doc).join(", ");
    if (!ALLOW_UNCONFIRMED) {
      console.error(
        `Labels not yet operator-confirmed: ${names}.\n` +
          `Review packages/course-schema/fixtures/labels/*.labels.json, set "confirmed": true,\n` +
          `or re-run with --allow-unconfirmed-labels while iterating.`
      );
      process.exit(1);
    }
    console.warn(`! Running with UNCONFIRMED labels: ${names}\n`);
  }

  // Pre-run cost estimate (pricing.ts price sheet).
  const pageGuess = 51; // doc-a 42 + doc-b 9; refined after conversion.
  const estimate = await convexRun("pipeline/llmCalls:estimateExtractionCost", {
    pages: pageGuess,
    avgTokensInPerPage: CONFIG.avgTokensInPerPage,
    avgTokensOutPerPage: CONFIG.avgTokensOutPerPage,
  });
  console.log(`Models: ${JSON.stringify(estimate.models)}`);
  console.log(
    `Estimated cost (~${pageGuess} pages): ` +
      (estimate.estimateUsd !== null
        ? `$${estimate.estimateUsd.toFixed(4)} (price sheet verified ${estimate.priceSheetVerifiedAt})`
        : "unknown — model missing from llm/pricing.ts")
  );
  if (!YES) {
    console.error("\nThis run costs real money. Re-run with --yes to proceed.");
    process.exit(1);
  }

  // --- Upload, register, run ---
  console.log("\nSeeding institution + uploading fixtures…");
  const institutionId = await convexRun("pipeline/seed:seed");
  const docIdByFixture = new Map();
  const sourceDocIds = [];
  for (const label of labels) {
    const fixture = findFixtureDoc(label.doc);
    if (!fixture) throw new Error(`fixture ${label.doc}.(pptx|pdf) not found`);
    const key = await uploadDoc(fixture);
    const sourceDocId = await convexRun("pipeline/ingestion:registerSourceDoc", {
      institutionId,
      objectKey: key,
      kind: fixture.kind,
    });
    docIdByFixture.set(label.doc, sourceDocId);
    sourceDocIds.push(sourceDocId);
    console.log(`  ${fixture.name} -> ${sourceDocId}`);
  }

  const runId = await convexRun("pipeline/runs:startRun", {
    institutionId,
    sourceDocIds,
  });
  console.log(`  run: ${runId}\n`);

  // --- Wait for extraction to complete (run parks at gate 1) ---
  const DONE_STATES = new Set([
    "EXTRACTED",
    "COMPILING",
    "COMPILED",
    "GATE_1_KNOWLEDGE_REVIEW",
  ]);
  const startedAt = Date.now();
  let lastState = null;
  let run;
  for (;;) {
    if (Date.now() - startedAt > (CONFIG.timeoutMs ?? 900000)) {
      throw new Error(`timed out waiting for extraction (last state: ${lastState})`);
    }
    ({ run } = await convexRun("pipeline/queries:getRunInternal", { runId }));
    if (run.state !== lastState) {
      console.log(`state: ${run.state}`);
      lastState = run.state;
    }
    if (run.state === "FAILED") {
      throw new Error(`run FAILED: ${JSON.stringify(run.error)}`);
    }
    if (DONE_STATES.has(run.state)) break;
    await sleep(2000);
  }

  // --- Collect results ---
  const inventory = await convexRun("pipeline/inventory:listInventoryForRun", { runId });
  const cost = await convexRun("pipeline/llmCalls:getRunCostInternal", { runId });

  const concepts = inventory.filter((i) => i.kind === "concept").map((i) => i.body);
  const facts = inventory.filter((i) => i.kind === "fact").map((i) => i.body);
  const entities = inventory.filter((i) => i.kind === "entity").map((i) => i.body);

  console.log(
    `\nInventory: ${concepts.length} concepts, ${facts.length} facts ` +
      `(${facts.filter((f) => f.flagged).length} flagged), ${entities.length} entities`
  );

  // --- Score per fixture ---
  const fixtureResults = [];
  let allPass = true;

  for (const label of labels) {
    const sourceDocId = docIdByFixture.get(label.doc);
    const docPrefix = `doc:${sourceDocId}:page:`;
    const inDoc = (provenance) => provenance.some((p) => p.startsWith(docPrefix));

    const docConcepts = concepts.filter((c) => inDoc(c.pageProvenance));
    const docFacts = facts.filter((f) => inDoc(f.provenance));
    const docEntities = entities.filter((e) => inDoc(e.provenance));

    // Concept recall.
    const missedConcepts = [];
    let matched = 0;
    for (const labelled of label.concepts) {
      if (docConcepts.some((c) => titlesMatch(labelled.title, c.title))) {
        matched += 1;
      } else {
        missedConcepts.push(labelled.title);
      }
    }
    const recall = label.concepts.length === 0 ? 1 : matched / label.concepts.length;
    const threshold = CONFIG.conceptRecallThreshold[label.doc] ?? 0.8;
    const recallPass = recall >= threshold;

    // Flag completeness: every known-dirty statistic must surface as a
    // flagged fact whose statement contains all match keywords.
    const missedFlags = [];
    for (const dirty of label.knownDirtyStatistics) {
      const found = docFacts.some(
        (f) =>
          f.flagged &&
          dirty.match.every((kw) =>
            f.statement.toLowerCase().includes(kw.toLowerCase())
          )
      );
      if (!found) missedFlags.push(dirty.id);
    }
    const flagsPass = missedFlags.length === 0;

    // Precision guard (warn only).
    const ratio = label.concepts.length === 0 ? 0 : docConcepts.length / label.concepts.length;
    const ratioWarn = ratio > (CONFIG.maxConceptRatio ?? 3);

    // Must-extract entities (warn only).
    const missedEntities = label.mustExtractEntities.filter(
      (want) =>
        !docEntities.some(
          (e) =>
            e.kind === want.kind &&
            e.value.toLowerCase().includes(want.value.toLowerCase())
        )
    );

    const pass = recallPass && flagsPass;
    allPass = allPass && pass;

    console.log(`\n— ${label.doc} ${pass ? "PASS" : "FAIL"}`);
    console.log(
      `  concept recall: ${matched}/${label.concepts.length} = ${recall.toFixed(2)} ` +
        `(threshold ${threshold}) ${recallPass ? "ok" : "FAIL"}`
    );
    if (missedConcepts.length > 0) {
      console.log(`    missed: ${missedConcepts.join(" | ")}`);
    }
    console.log(
      `  flag completeness: ${label.knownDirtyStatistics.length - missedFlags.length}/` +
        `${label.knownDirtyStatistics.length} known-dirty stats flagged ${flagsPass ? "ok" : "FAIL"}`
    );
    if (missedFlags.length > 0) {
      console.log(`    missed flags: ${missedFlags.join(", ")}`);
    }
    console.log(
      `  precision guard: ${docConcepts.length} extracted vs ${label.concepts.length} labelled ` +
        `(ratio ${ratio.toFixed(1)})${ratioWarn ? " WARN: high — check for shallow concepts" : ""}`
    );
    if (missedEntities.length > 0) {
      console.log(
        `  WARN missing entities: ${missedEntities.map((e) => `${e.kind}:${e.value}`).join(", ")}`
      );
    }

    fixtureResults.push({
      doc: label.doc,
      pass,
      conceptRecall: recall,
      threshold,
      missedConcepts,
      flagCompleteness: flagsPass,
      missedFlags,
      conceptRatio: ratio,
      missedEntities: missedEntities.map((e) => `${e.kind}:${e.value}`),
    });
  }

  // --- Cost + provenance of the eval itself ---
  console.log(`\nPrompt versions: ${JSON.stringify(run.promptVersions)}`);
  console.log(
    `Actual cost: $${cost.totalUsd.toFixed(4)} across ${cost.totalCalls} calls` +
      (estimate.estimateUsd !== null
        ? ` (estimated $${estimate.estimateUsd.toFixed(4)})`
        : "")
  );
  for (const row of cost.byStage) {
    console.log(`  ${row.stage} [${row.model}]: $${row.costUsd.toFixed(4)} / ${row.calls} call(s)`);
  }

  appendFileSync(
    HISTORY_FILE,
    JSON.stringify({
      at: new Date().toISOString(),
      runId,
      promptVersions: run.promptVersions,
      fixtures: fixtureResults,
      costUsd: cost.totalUsd,
      estimatedUsd: estimate.estimateUsd,
      pass: allPass,
    }) + "\n"
  );
  console.log(`\nAppended to eval-history.jsonl`);

  if (!allPass) {
    console.error("\nEVAL FAILED");
    process.exit(1);
  }
  console.log("\nEVAL PASSED");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
