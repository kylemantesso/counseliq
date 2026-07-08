#!/usr/bin/env node

/**
 * Pipeline exit test: drive a run end-to-end against the dev deployment,
 * with REAL ingestion (M2), REAL LLM extraction (M3), REAL compilation +
 * QA judging (M4), and REAL script normalisation + TTS synthesis + publish
 * (M5).
 *
 * 1. Upload both fixture docs (presigned PUT) from
 *    packages/course-schema/fixtures/ingestion/doc-{a,b}.(pptx|pdf)
 * 2. registerSourceDoc x 2, startRun (docs linked to the run)
 * 3. Watch CONVERTING -> CONVERTED with per-doc progress
 * 4. Watch EXTRACTING -> EXTRACTED (real LLM extraction; running cost printed)
 * 5. Resolve every gate-1 flagged-fact item, approve gate 1 — the compiler
 *    then builds the course from the reviewed inventory and the QA judge
 *    traces it (M4 order: gate 1 -> COMPILING -> QA -> gate 2)
 * 6. Print the TTS character/cost estimate, approve gate 2 —
 *    GENERATING_SCRIPT normalises narration (blocked units surface here),
 *    GENERATING_ASSETS synthesises per-sentence audio + timing artifacts
 * 7. At GATE_3_PREVIEW: print the readiness summary + player URL; approve
 *    (or --pause-at-gate-3 to review in the studio first)
 * 8. PUBLISHING -> PUBLISHED: print the publish snapshot (version, specHash,
 *    export/manifest keys), verify every manifest artifact exists in the
 *    object store, and print per-stage timings + the LLM/TTS cost split
 *
 * Usage:
 *   npm run walkthrough -- --yes           — full run (costs real money; the
 *                                            estimate is printed first)
 *   npm run walkthrough -- --skip-docs     — M1-style run with no source docs
 *                                            (conversion no-ops through; free)
 *   npm run walkthrough -- --resume <runId>— continue a parked run (e.g. one
 *                                            eval:compile left at gate 2)
 *                                            from wherever it is
 *   npm run walkthrough -- --yes --pause-at-gate-3
 *                                          — stop at gate 3 with the player
 *                                            URL printed (the demo path)
 *
 * TTS_PROVIDER=mock makes GENERATING_ASSETS free (deterministic mock audio);
 * the script says so loudly. Requires `npx convex dev` to have been run once
 * so the project is linked to a dev deployment.
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
const YES = process.argv.includes("--yes");
const PAUSE_AT_GATE_3 = process.argv.includes("--pause-at-gate-3");
const resumeIndex = process.argv.indexOf("--resume");
const RESUME_RUN_ID =
  resumeIndex !== -1 ? process.argv[resumeIndex + 1] : null;
if (resumeIndex !== -1 && !RESUME_RUN_ID) {
  console.error("--resume requires a run id: --resume <runId>");
  process.exit(1);
}

const WEB_PORT = process.env.WEB_PORT ?? "3005";
const TTS_MOCKED = process.env.TTS_PROVIDER === "mock";

const GATE_STATES = {
  GATE_1_KNOWLEDGE_REVIEW: 1,
  GATE_2_COURSE_REVIEW: 2,
  GATE_3_PREVIEW: 3,
};

const CONTENT_TYPES = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
};

const POLL_INTERVAL_MS = 1000;
const TIMEOUT_MS = 20 * 60 * 1000;

// Pre-run estimate assumptions (real page/unit counts are unknown until
// conversion/compilation; these mirror eval.config.json's heuristics).
const ESTIMATE_PAGES = 24;
const ESTIMATE_UNITS = 12;

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

function formatDuration(ms) {
  return ms >= 60_000
    ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
    : `${(ms / 1000).toFixed(1)}s`;
}

function playerUrl(runId) {
  return `http://localhost:${WEB_PORT}/admin/runs/${runId}/gate-3`;
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

/** Print the LLM + TTS pre-run estimate; exit unless --yes (docs mode). */
async function costGate() {
  const extraction = await convexRun("pipeline/llmCalls:estimateExtractionCost", {
    pages: ESTIMATE_PAGES,
    avgTokensInPerPage: 2000,
    avgTokensOutPerPage: 700,
  });
  const compile = await convexRun("pipeline/llmCalls:estimateCompileCost", {
    units: ESTIMATE_UNITS,
    avgTokensInPerUnit: 6000,
    avgTokensOutPerUnit: 2500,
  });
  console.log(`Pre-run cost estimate (assuming ~${ESTIMATE_PAGES} pages, ~${ESTIMATE_UNITS} units):`);
  console.log(
    `  extraction: ${extraction?.estimateUsd != null ? `$${extraction.estimateUsd.toFixed(4)}` : "unknown"}`
  );
  console.log(
    `  compile+judge: ${compile?.estimateUsd != null ? `$${compile.estimateUsd.toFixed(4)}` : "unknown"}`
  );
  if (TTS_MOCKED) {
    console.log("  TTS: $0 — TTS is MOCKED (TTS_PROVIDER=mock), no ElevenLabs spend");
  } else {
    console.log(
      "  TTS: estimated precisely at gate 2 (per-character, after narration exists)"
    );
  }
  if (!YES) {
    console.error(
      "\nThis run costs real money. Re-run with --yes to proceed " +
        "(or TTS_PROVIDER=mock npm run dev:stack for free TTS)."
    );
    process.exit(1);
  }
}

/** Print the exact TTS estimate at gate 2; enforce --yes for live TTS. */
async function ttsGate(runId) {
  const estimate = await convexRun("pipeline/tts/calls:estimateTtsCostForRun", {
    runId,
  });
  console.log(
    `  TTS estimate: ~${estimate.characters} chars ≈ ` +
      (estimate.estimateUsd != null
        ? `$${estimate.estimateUsd.toFixed(4)}`
        : "unknown") +
      ` (voice ${estimate.voiceRef ?? "unset"}, model ${estimate.model}, exact=${estimate.exact})`
  );
  if (TTS_MOCKED) {
    console.log("  ⚠ TTS is MOCKED (TTS_PROVIDER=mock) — no ElevenLabs spend");
    return;
  }
  if (!YES) {
    console.error(
      "\nApproving gate 2 starts live TTS synthesis. Re-run with --yes " +
        "(or set TTS_PROVIDER=mock on the deployment for a free rehearsal)."
    );
    process.exit(1);
  }
}

/** Gate-3 readiness summary. Returns { canApprove }. */
async function printGate3Summary(runId) {
  const preview = await convexRun("pipeline/tts/preview:getRunPreviewInternal", {
    runId,
  });
  if (!preview) {
    throw new Error("gate 3 reached but the run has no preview data");
  }
  const { summary } = preview;
  console.log(
    `  gate 3: ${summary.ready}/${summary.total} units ready, ` +
      `${summary.blocked} blocked, ${summary.failed} failed — ` +
      `course duration ${formatDuration(summary.totalDurationMs)}, ` +
      `${summary.totalCharacters} narration chars`
  );
  const problems = [];
  for (const module of preview.modules) {
    for (const unit of module.units) {
      if (unit.state === "blocked") {
        const terms = (unit.script?.sentences ?? [])
          .flatMap((s) => s.blockedTerms ?? [])
          .join(", ");
        problems.push(`    BLOCKED ${unit.unitKey}: unresolved pronunciation (${terms || "see review item"})`);
      } else if (unit.error) {
        problems.push(`    FAILED  ${unit.unitKey}: ${unit.error.cause}`);
      }
    }
  }
  for (const line of problems) console.log(line);
  console.log(`  player: ${playerUrl(runId)}`);
  return { canApprove: summary.blocked === 0 && summary.failed === 0 };
}

/** Per-stage wall-clock table from the runEvents journal. */
function printStageTimings(events) {
  console.log("\nPer-stage timings:");
  for (let i = 0; i < events.length; i++) {
    const stage = events[i].toState;
    const start = events[i]._creationTime;
    const end = events[i + 1]?._creationTime;
    if (end === undefined) break; // terminal state has no duration
    console.log(
      `  ${stage.padEnd(24)} ${formatDuration(end - start)}`
    );
  }
}

async function printPublishSummary(runId) {
  const snapshot = await convexRun(
    "pipeline/publishedCourses:getPublishedCourseForRunInternal",
    { runId }
  );
  if (!snapshot) {
    console.error("\nPUBLISHED but no courseVersions snapshot found — inspect the run.");
    process.exit(1);
  }
  console.log("\nPublish snapshot:");
  console.log(`  version:   v${snapshot.version} (published by ${snapshot.publishedBy})`);
  console.log(`  specHash:  ${snapshot.specHash}`);
  console.log(`  export:    ${snapshot.exportKey}`);
  console.log(`  manifest:  ${snapshot.manifestKey}`);
  console.log(
    `  counts:    ${snapshot.counts.modules} modules, ${snapshot.counts.units} units, ` +
      `${snapshot.counts.questions} questions, ${snapshot.counts.audioArtifacts} audio artifacts`
  );

  const verification = await convexRun("pipeline/publish:verifyPublishedArtifacts", {
    runId,
  });
  if (!verification.ok) {
    console.error(
      `\nARTIFACT VERIFICATION FAILED — ${verification.missing.length} missing:\n` +
        verification.missing.map((key) => `  ${key}`).join("\n")
    );
    process.exit(1);
  }
  console.log(`  artifacts: ${verification.checked} verified in the object store ✓`);
}

async function printCostSplit(runId, docCount) {
  const cost = await convexRun("pipeline/llmCalls:getRunCostInternal", { runId });
  console.log("\nCost:");
  console.log(
    `  LLM: $${cost.totalUsd.toFixed(4)} across ${cost.totalCalls} calls ` +
      `(${cost.totalTokensIn} in / ${cost.totalTokensOut} out tokens)`
  );
  for (const row of cost.byStage) {
    console.log(
      `    ${row.stage} [${row.model}]: $${row.costUsd.toFixed(4)} over ${row.calls} call(s)`
    );
  }
  console.log(
    `  TTS: $${cost.tts.totalUsd.toFixed(4)} across ${cost.tts.totalCalls} calls ` +
      `(${cost.tts.totalCharacters} characters${TTS_MOCKED ? ", MOCKED" : ", estimated from the price sheet"})`
  );
  for (const row of cost.tts.byStage) {
    console.log(
      `    ${row.stage} [${row.model}]: $${row.costUsd.toFixed(4)} over ${row.calls} call(s)`
    );
  }
  console.log(
    `  run total: LLM $${cost.totalUsd.toFixed(4)} + TTS $${cost.tts.totalUsd.toFixed(4)} = $${cost.grandTotalUsd.toFixed(4)}`
  );
  console.log(`  $/doc: $${(cost.grandTotalUsd / docCount).toFixed(4)}`);
}

/**
 * Poll a run through its states, deciding gates as they park. Shared by the
 * fresh-run path and --resume.
 */
async function driveRun(runId, { sourceDocIds, docNamesById }) {
  const decidedGates = new Set();
  const docStatuses = new Map();
  const docThemes = new Map();
  let lastState = null;
  let lastCostPrinted = 0;
  let lastAssetsReady = -1;
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

    // Running LLM cost while extraction or compilation is live.
    if (["EXTRACTING", "COMPILING", "QA_RUNNING"].includes(run.state)) {
      const cost = await convexRun("pipeline/llmCalls:getRunCostInternal", {
        runId,
      });
      if (cost.totalCalls > 0 && cost.totalUsd !== lastCostPrinted) {
        lastCostPrinted = cost.totalUsd;
        console.log(
          `  LLM cost so far: $${cost.totalUsd.toFixed(4)} (${cost.totalCalls} calls)`
        );
      }
    }

    // Running TTS progress while synthesis is live (M5).
    if (["GENERATING_SCRIPT", "GENERATING_ASSETS"].includes(run.state)) {
      const preview = await convexRun(
        "pipeline/tts/preview:getRunPreviewInternal",
        { runId }
      );
      if (preview && preview.summary.ready !== lastAssetsReady) {
        lastAssetsReady = preview.summary.ready;
        const cost = await convexRun("pipeline/llmCalls:getRunCostInternal", {
          runId,
        });
        console.log(
          `  assets: ${preview.summary.ready}/${preview.summary.total} units ready` +
            (cost.tts.totalCalls > 0
              ? ` — TTS cost so far: $${cost.tts.totalUsd.toFixed(4)} (${cost.tts.totalCalls} calls)`
              : "")
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

      // M3: inventory summary.
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

      // M5: publish snapshot + artifact verification, timings, cost split.
      await printPublishSummary(runId);
      printStageTimings(events);
      await printCostSplit(runId, sourceDocIds.length || 1);
      console.log(`\nPlayer: ${playerUrl(runId)}`);
      return;
    }

    // M6.5: the editable outline step — the walkthrough approves the
    // proposed outline unchanged (a human would edit it in /admin/runs/
    // {id}/outline before approving).
    if (run.state === "OUTLINE_REVIEW" && !decidedGates.has("outline")) {
      decidedGates.add("outline");
      console.log("  outline: auto-approving the proposed course outline…");
      await convexRun("pipeline/outlineReview:approveOutline", {
        runId,
        reviewer: "walkthrough-script",
      });
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const gate = GATE_STATES[run.state];
    if (gate && !decidedGates.has(gate)) {
      decidedGates.add(gate);

      // Gate 1 (M3): every flagged-fact item must be individually resolved
      // before the gate can be approved. The walkthrough auto-approves each
      // with a placeholder source so the pipeline can proceed.
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

      // Gate 2 (M5): approving starts script normalisation + TTS synthesis —
      // print the exact character/cost estimate first.
      if (gate === 2) {
        await ttsGate(runId);
      }

      // Gate 3 (M5): the playable preview. Blocked/failed units make
      // approval impossible; --pause-at-gate-3 hands over to the studio.
      if (gate === 3) {
        const { canApprove } = await printGate3Summary(runId);
        if (PAUSE_AT_GATE_3) {
          console.log(
            "\nPaused at gate 3. Open the player URL above, review the course, " +
              "then approve in the studio — or re-run with:\n" +
              `  npm run walkthrough -- --yes --resume ${runId}`
          );
          process.exit(0);
        }
        if (!canApprove) {
          console.error(
            "\nGate 3 cannot be approved: blocked/failed units remain (listed above).\n" +
              "Resolve pronunciations (institutions.pronunciationLexicon) or retry failed\n" +
              `units in the studio (${playerUrl(runId)}), then re-run with --resume ${runId}.`
          );
          process.exit(2);
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

async function main() {
  console.log("== CounselIQ pipeline walkthrough ==\n");
  if (TTS_MOCKED) {
    console.log("⚠ TTS is MOCKED (TTS_PROVIDER=mock) — no ElevenLabs spend.\n");
  }

  if (RESUME_RUN_ID) {
    console.log(`Resuming run ${RESUME_RUN_ID} from its current state…\n`);
    // Doc summaries are skipped on resume (the docs map lives with the
    // original invocation); gates/publish work identically.
    await driveRun(RESUME_RUN_ID, {
      sourceDocIds: [],
      docNamesById: new Map(),
    });
    return;
  }

  if (!SKIP_DOCS) {
    await costGate();
    console.log("");
  }

  console.log("Seeding institution…");
  const institutionId = await convexRun("pipeline/seed:seed");
  console.log(`  institution: ${institutionId}`);

  const sourceDocIds = [];
  const docNamesById = new Map();

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

  await driveRun(runId, { sourceDocIds, docNamesById });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
