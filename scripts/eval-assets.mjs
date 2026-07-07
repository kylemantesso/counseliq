#!/usr/bin/env node

/**
 * M5 assets eval (exit test): takes a compiled, judged run parked at
 * GATE_2_COURSE_REVIEW (the state eval:compile leaves behind), approves gate 2,
 * waits for script normalisation + TTS synthesis, and scores the results:
 *
 *   - every non-blocked unit reaches assets_ready with a VERSIONED timing
 *     artifact
 *   - every narration sentence has a per-sentence audio artifact in its
 *     timing entry
 *   - card beats resolved for every card (cardBeats count == cards count)
 *   - blocked/failed units FAIL the eval (the harness has no human to
 *     resolve pronunciations — that is gate-3's job in a real run)
 *
 * then approves gate 3, waits for PUBLISHING -> PUBLISHED, and verifies the
 * publish round-trip: courseVersions snapshot exists and every manifest
 * artifact key resolves in the object store.
 *
 *   npm run eval:compile -- --yes            # first: park a run at gate 2
 *   npm run eval:assets -- --yes             # then: drive it through TTS+publish
 *   npm run eval:assets -- --yes --run <id>  # target a specific gate-2 run
 *
 * TTS cost is per-character; the estimate is printed before anything spends
 * money. TTS_PROVIDER=mock on the deployment makes the run free (CI-style).
 * Appends a kind:"assets" row to eval-history.jsonl.
 */

import { spawn } from "child_process";
import { appendFileSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HISTORY_FILE = path.join(ROOT, "eval-history.jsonl");

const YES = process.argv.includes("--yes");
const runFlagIndex = process.argv.indexOf("--run");
const RUN_ID_ARG = runFlagIndex !== -1 ? process.argv[runFlagIndex + 1] : null;
if (runFlagIndex !== -1 && !RUN_ID_ARG) {
  console.error("--run requires a run id: --run <runId>");
  process.exit(1);
}

const CONFIG = JSON.parse(readFileSync(path.join(ROOT, "eval.config.json"), "utf8"));

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

/** Score the synthesised course at gate 3. */
function scoreAssets(preview) {
  const issues = [];
  const blockedUnits = [];
  const failedUnits = [];
  let unitCount = 0;
  let sentenceCount = 0;
  let characters = 0;

  for (const module of preview.modules) {
    for (const unit of module.units) {
      unitCount += 1;
      if (unit.state === "blocked") {
        const terms = (unit.script?.sentences ?? [])
          .flatMap((s) => s.blockedTerms ?? [])
          .join(", ");
        blockedUnits.push(`${unit.unitKey} (${terms || "unresolved lexicon"})`);
        continue;
      }
      if (unit.error) {
        failedUnits.push(`${unit.unitKey}: ${unit.error.cause}`);
        continue;
      }
      if (unit.state !== "assets_ready" && unit.state !== "published") {
        issues.push(`${unit.unitKey}: state ${unit.state}, expected assets_ready`);
        continue;
      }
      const timing = unit.timing;
      if (!timing || typeof timing.version !== "number") {
        issues.push(`${unit.unitKey}: missing or unversioned timing artifact`);
        continue;
      }
      const narration = unit.narration ?? [];
      const timingByNarrationId = new Map(
        timing.sentences.map((s) => [s.narrationId, s])
      );
      for (const sentence of narration) {
        sentenceCount += 1;
        const entry = timingByNarrationId.get(sentence.id);
        if (!entry) {
          issues.push(`${unit.unitKey}: sentence ${sentence.id} has no timing entry`);
        } else if (!entry.audioKey) {
          issues.push(`${unit.unitKey}: sentence ${sentence.id} has no audio artifact`);
        } else {
          characters += entry.speakText.length;
        }
      }
      const cards = unit.cards ?? [];
      if ((timing.cardBeats ?? []).length !== cards.length) {
        issues.push(
          `${unit.unitKey}: ${timing.cardBeats?.length ?? 0} beats for ${cards.length} cards`
        );
      }
    }
  }

  return {
    pass: issues.length === 0 && blockedUnits.length === 0 && failedUnits.length === 0,
    issues,
    blockedUnits,
    failedUnits,
    unitCount,
    sentenceCount,
    characters,
  };
}

async function main() {
  console.log("== CounselIQ assets eval ==\n");

  // --- Find the gate-2 run to drive ---
  let runId = RUN_ID_ARG;
  if (!runId) {
    const runs = await convexRun("pipeline/queries:listRunsByStateInternal", {
      state: "GATE_2_COURSE_REVIEW",
    });
    const candidate = runs.find((run) => run.courseId);
    if (!candidate) {
      throw new Error(
        "no run parked at GATE_2_COURSE_REVIEW — run `npm run eval:compile -- --yes` first"
      );
    }
    runId = candidate._id;
  }
  console.log(`Run at gate 2: ${runId}`);

  // --- Cost gate ---
  const estimate = await convexRun("pipeline/tts/calls:estimateTtsCostForRun", {
    runId,
  });
  console.log(
    `TTS estimate: ~${estimate.characters} chars ≈ ` +
      (estimate.estimateUsd != null ? `$${estimate.estimateUsd.toFixed(4)}` : "unknown") +
      ` (voice ${estimate.voiceRef ?? "unset"}, model ${estimate.model}, ` +
      `price sheet verified ${estimate.priceSheetVerifiedAt ?? "n/a"})`
  );
  if (process.env.TTS_PROVIDER === "mock") {
    console.log("⚠ TTS is MOCKED (TTS_PROVIDER=mock) — no ElevenLabs spend");
  }
  if (!YES) {
    console.error("\nThis run costs real money. Re-run with --yes to proceed.");
    process.exit(1);
  }

  // --- Approve gate 2 → synthesis ---
  console.log("\nApproving gate 2 (starts script normalisation + TTS)…");
  await convexRun("pipeline/runs:decideGate", {
    runId,
    gate: 2,
    decision: "approve",
    reviewer: "eval-assets-script",
  });

  const timeoutMs = CONFIG.assetsTimeoutMs ?? 1_800_000;
  const startedAt = Date.now();
  let lastState = null;
  let lastReady = -1;
  for (;;) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`timed out waiting for gate 3 (last state: ${lastState})`);
    }
    const { run } = await convexRun("pipeline/queries:getRunInternal", { runId });
    if (run.state !== lastState) {
      console.log(`state: ${run.state}`);
      lastState = run.state;
    }
    if (run.state === "FAILED") {
      throw new Error(`run FAILED: ${JSON.stringify(run.error)}`);
    }
    if (run.state === "GENERATING_ASSETS" || run.state === "GENERATING_SCRIPT") {
      const preview = await convexRun("pipeline/tts/preview:getRunPreviewInternal", {
        runId,
      });
      if (preview && preview.summary.ready !== lastReady) {
        lastReady = preview.summary.ready;
        console.log(`  assets: ${preview.summary.ready}/${preview.summary.total} units ready`);
      }
    }
    if (run.state === "GATE_3_PREVIEW") break;
    await sleep(2000);
  }

  // --- Score at gate 3 ---
  const preview = await convexRun("pipeline/tts/preview:getRunPreviewInternal", {
    runId,
  });
  const score = scoreAssets(preview);
  console.log("\n== Scores ==");
  console.log(
    `  units: ${score.unitCount}; sentences with audio+timing: ` +
      `${score.sentenceCount - score.issues.filter((i) => i.includes("sentence")).length}/${score.sentenceCount}; ` +
      `synthesised characters: ${score.characters}`
  );
  console.log(
    `  timing artifacts: ${score.issues.length === 0 ? "all versioned, all beats resolved ok" : `${score.issues.length} issue(s) FAIL`}`
  );
  for (const issue of score.issues) console.log(`    ${issue}`);
  if (score.blockedUnits.length > 0) {
    console.log(`  blocked units (FAIL): ${score.blockedUnits.join("; ")}`);
  }
  if (score.failedUnits.length > 0) {
    console.log(`  failed units (FAIL): ${score.failedUnits.join("; ")}`);
  }

  // --- Publish (only when clean — gate 3 refuses blocked/failed anyway) ---
  let publishOk = false;
  let artifactCount = 0;
  let snapshot = null;
  if (score.pass) {
    console.log("\nApproving gate 3 (publish)…");
    await convexRun("pipeline/runs:decideGate", {
      runId,
      gate: 3,
      decision: "approve",
      reviewer: "eval-assets-script",
    });
    for (;;) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`timed out waiting for PUBLISHED (last state: ${lastState})`);
      }
      const { run } = await convexRun("pipeline/queries:getRunInternal", { runId });
      if (run.state !== lastState) {
        console.log(`state: ${run.state}`);
        lastState = run.state;
      }
      if (run.state === "FAILED") {
        throw new Error(`publish FAILED: ${JSON.stringify(run.error)}`);
      }
      if (run.state === "PUBLISHED") break;
      await sleep(2000);
    }

    snapshot = await convexRun(
      "pipeline/publishedCourses:getPublishedCourseForRunInternal",
      { runId }
    );
    const verification = await convexRun("pipeline/publish:verifyPublishedArtifacts", {
      runId,
    });
    publishOk = snapshot !== null && verification.ok;
    artifactCount = verification.checked;
    console.log(
      `\nPublished v${snapshot?.version} — specHash ${snapshot?.specHash}\n` +
        `  export:   ${snapshot?.exportKey}\n` +
        `  manifest: ${snapshot?.manifestKey}\n` +
        `  artifacts: ${verification.ok ? `${verification.checked} verified ok` : `MISSING ${verification.missing.join(", ")} FAIL`}`
    );
  }

  // --- Cost + history ---
  const cost = await convexRun("pipeline/llmCalls:getRunCostInternal", { runId });
  console.log(
    `\nCost: LLM $${cost.totalUsd.toFixed(4)} + TTS $${cost.tts.totalUsd.toFixed(4)} ` +
      `= $${cost.grandTotalUsd.toFixed(4)} (TTS: ${cost.tts.totalCharacters} chars, estimated pricing)`
  );

  const pass = score.pass && publishOk;
  appendFileSync(
    HISTORY_FILE,
    JSON.stringify({
      at: new Date().toISOString(),
      kind: "assets",
      runId,
      characters: cost.tts.totalCharacters,
      ttsCostUsd: cost.tts.totalUsd,
      estimatedUsd: estimate.estimateUsd,
      unitCount: score.unitCount,
      sentenceCount: score.sentenceCount,
      blockedUnits: score.blockedUnits,
      failedUnits: score.failedUnits,
      timingIssues: score.issues,
      publishOk,
      artifactCount,
      version: snapshot?.version ?? null,
      specHash: snapshot?.specHash ?? null,
      pass,
    }) + "\n"
  );
  console.log(`\nAppended to eval-history.jsonl`);

  if (!pass) {
    console.error("\nASSETS EVAL FAILED");
    process.exit(1);
  }
  console.log("\nASSETS EVAL PASSED");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
