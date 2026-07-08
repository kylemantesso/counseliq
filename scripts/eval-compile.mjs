#!/usr/bin/env node

/**
 * M4 compiler eval (exit test): drives a REAL run over golden fixture #1's
 * source docs, auto-resolves gate 1 (walkthrough-style), waits for the
 * compiled + judged course at GATE_2_COURSE_REVIEW, and scores it against
 * packages/course-schema/fixtures/golden-fixture-1.json.
 *
 *   npm run eval:compile -- --yes               # costs real money
 *   npm run eval:compile -- --yes --reuse       # score the newest run already
 *                                               # parked at gate 2 (no compile)
 *   npm run eval:compile -- --yes --judge-only  # judge eval only: three seeded
 *                                               # known-bad courses through
 *                                               # runQaJudge
 *
 * The golden fixture was authored from DIFFERENT source material (a specific
 * requested course), so it is a FORMAT reference only — no content/concept
 * comparison is scored against it.
 *
 * Scores:
 *   - structural sanity (format vs golden): module count within ±1 of
 *     golden; every unit has a hook, ≥1 resolving retrieve, an anchor,
 *     narration and cards; generic cards within the 1-in-3 cap and never
 *     consecutive. Compiled concepts are printed for information.
 *   - compliance invariants (pass/fail): judge-clean narration (no
 *     unsupported-claim flags), zero banned-claim flags, stat cards carry
 *     sourceLabel, mechanical excluded-fact leak check clean, every unit
 *     judged. Other judge flags (redundant-card, pedagogy lint) are
 *     REPORTED for gate-2 review but do not fail the eval.
 *
 * Prints per-metric scores, prompt+model versions, and $/course; appends a
 * kind:"compile" row to eval-history.jsonl. Extraction re-uses the per-page
 * cache automatically when the fixture docs are unchanged, so a fresh run's
 * marginal cost is dominated by compile + judge.
 *
 * Prerequisites: `npm run dev:stack` running with OPENROUTER_API_KEY set on
 * the local deployment (same setup as `npm run eval`).
 */

import { spawn } from "child_process";
import { createHash } from "crypto";
import { appendFileSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(ROOT, "packages/course-schema/fixtures/ingestion");
const GOLDEN_FILE = path.join(
  ROOT,
  "packages/course-schema/fixtures/golden-fixture-1.json"
);
const HISTORY_FILE = path.join(ROOT, "eval-history.jsonl");

const YES = process.argv.includes("--yes");
const JUDGE_ONLY = process.argv.includes("--judge-only");
const REUSE = process.argv.includes("--reuse");

const CONFIG = JSON.parse(readFileSync(path.join(ROOT, "eval.config.json"), "utf8"));

const CONTENT_TYPES = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  mp4: "video/mp4",
  zip: "application/zip",
};

const MEDIA_FIXTURES_DIR = path.join(ROOT, "packages/course-schema/fixtures/media");
// Small, varied set: two images + one short (audio-carrying) clip. The 90s
// clip and junk zip stay out — rejection paths are converter-unit-tested.
const MEDIA_FIXTURES = ["photo.jpg", "wide-huge.jpg", "logo.png", "clip-2s.mp4"];

const GENERIC_TEMPLATES = new Set(["text-card"]);
const STAT_TEMPLATES = new Set(["stat-card", "chart-card"]);

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

// --- Drive a fresh run to GATE_2_COURSE_REVIEW ---

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

async function driveFreshRun(institutionName) {
  console.log("Seeding institution + uploading golden fixture source docs…");
  const institutionId = await convexRun("pipeline/seed:seed", {
    name: institutionName,
  });
  const sourceDocIds = [];
  for (const name of ["doc-a", "doc-b"]) {
    const fixture = findFixtureDoc(name);
    if (!fixture) throw new Error(`fixture ${name}.(pptx|pdf) not found in ${FIXTURES_DIR}`);
    const key = await uploadDoc(fixture);
    const sourceDocId = await convexRun("pipeline/ingestion:registerSourceDoc", {
      institutionId,
      objectKey: key,
      kind: fixture.kind,
    });
    sourceDocIds.push(sourceDocId);
    console.log(`  ${fixture.name} -> ${sourceDocId}`);
  }
  await setupAssetLibrary(institutionId);

  const runId = await convexRun("pipeline/runs:startRun", { institutionId, sourceDocIds });
  console.log(`  run: ${runId}\n`);

  const startedAt = Date.now();
  const timeoutMs = CONFIG.compileTimeoutMs ?? 1_800_000;
  let lastState = null;
  let lastCost = 0;
  let gate1Resolved = false;
  for (;;) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`timed out waiting for gate 2 (last state: ${lastState})`);
    }
    const { run } = await convexRun("pipeline/queries:getRunInternal", { runId });
    if (run.state !== lastState) {
      console.log(`state: ${run.state}`);
      lastState = run.state;
    }
    if (run.state === "FAILED") {
      throw new Error(`run FAILED: ${JSON.stringify(run.error)}`);
    }
    if (["EXTRACTING", "COMPILING", "QA_RUNNING"].includes(run.state)) {
      const cost = await convexRun("pipeline/llmCalls:getRunCostInternal", { runId });
      if (cost.totalCalls > 0 && cost.totalUsd !== lastCost) {
        lastCost = cost.totalUsd;
        console.log(`  LLM cost so far: $${cost.totalUsd.toFixed(4)} (${cost.totalCalls} calls)`);
      }
    }
    if (run.state === "GATE_1_KNOWLEDGE_REVIEW" && !gate1Resolved) {
      gate1Resolved = true;
      const items = await convexRun("pipeline/reviewItems:listReviewItemsForRun", {
        runId,
        gate: 1,
      });
      const pending = items.filter((item) => item.status === "pending");
      console.log(`  gate 1: resolving ${pending.length} flagged-fact item(s)…`);
      for (const item of pending) {
        await convexRun("pipeline/reviewItems:resolveReviewItem", {
          reviewItemId: item._id,
          resolution: "approve",
          sourceLabel: "eval-compile-auto",
          year: new Date().getFullYear(),
          reviewer: "eval-compile-script",
        });
      }
      console.log("  approving gate 1…");
      await convexRun("pipeline/runs:decideGate", {
        runId,
        gate: 1,
        decision: "approve",
        reviewer: "eval-compile-script",
      });
    }
    if (run.state === "GATE_2_COURSE_REVIEW") return runId;
    await sleep(2000);
  }
}

/**
 * M6: ingest fixture media, wait for tagging, and declare rights so the
 * compile weaves media through the golden course. Content-addressed and
 * stamp-cached, so a repeat eval fast-paths through this in seconds.
 * Rights are declared through the same audited mutation fields as the
 * admin page, with declaredBy "eval:auto".
 */
async function setupAssetLibrary(institutionId) {
  console.log("Ingesting fixture media into the asset library…");
  const files = [];
  for (const name of MEDIA_FIXTURES) {
    const filePath = path.join(MEDIA_FIXTURES_DIR, name);
    const bytes = readFileSync(filePath);
    const ext = name.split(".").pop();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const key = `sha256/${hash}.${ext}`;
    const { url } = await convexRun("pipeline/objectStore:presignPut", {
      key,
      contentType: CONTENT_TYPES[ext],
    });
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": CONTENT_TYPES[ext] },
      body: bytes,
    });
    if (!response.ok) throw new Error(`upload of ${name} failed: ${response.status}`);
    files.push({ sourceKey: key, originalName: name });
  }

  const { jobId } = await convexRun("pipeline/assetsIngest:ingestAssets", {
    institutionId,
    files,
    createdBy: "eval:auto",
  });
  const ingestDeadline = Date.now() + 180_000;
  for (;;) {
    const job = await convexRun("pipeline/assetsIngest:getIngestJobInternal", { jobId });
    if (job.status === "complete") {
      console.log(
        `  ingest complete: ${job.acceptedCount} accepted` +
          (job.rejected.length > 0 ? `, ${job.rejected.length} rejected` : "")
      );
      for (const entry of job.rejected) {
        console.log(`    rejected ${entry.originalName}: ${entry.reason}`);
      }
      break;
    }
    if (job.status === "failed") throw new Error(`asset ingest failed: ${job.error}`);
    if (Date.now() > ingestDeadline) {
      throw new Error("asset ingest timed out — is the converter (with ffmpeg) running?");
    }
    await sleep(2000);
  }

  const tagDeadline = Date.now() + 300_000;
  for (;;) {
    const status = await convexRun("pipeline/assetsCatalogue:getTaggingStatusInternal", {
      institutionId,
    });
    if (status.total > 0 && status.tagged === status.total) {
      console.log(`  tagging complete: ${status.tagged}/${status.total} assets`);
      break;
    }
    if (Date.now() > tagDeadline) {
      throw new Error(
        `asset tagging timed out (${status.tagged}/${status.total}) — OPENROUTER_API_KEY set?`
      );
    }
    await sleep(3000);
  }

  const { declared } = await convexRun(
    "pipeline/assetsCatalogue:declareAssetRightsInternal",
    { institutionId, rights: "institution_owned", declaredBy: "eval:auto" }
  );
  console.log(`  rights declared (eval:auto): ${declared} asset(s) cleared\n`);
}

// --- Scoring ---

function scoreCourse(golden, definition, courseRows, mediaReport) {
  const compiledUnits = definition.modules.flatMap((m) => m.microUnits);
  const questionIds = new Set(definition.questionBank.map((q) => q.id));
  const courseQa = courseRows.course.qa ?? null;

  const failures = [];
  const warnings = [];

  // 1. Structural sanity (the golden fixture is a FORMAT reference only —
  //    it was authored from different source material).
  const moduleDelta = Math.abs(definition.modules.length - golden.modules.length);
  const modulesPass = moduleDelta <= 1;
  if (!modulesPass) {
    failures.push(
      `module count ${definition.modules.length} vs golden ${golden.modules.length} (allowed ±1)`
    );
  }
  const structureIssues = [];
  for (const unit of compiledUnits) {
    if (!questionIds.has(unit.hook.questionRef)) {
      structureIssues.push(`${unit.unitId}: hook ref does not resolve`);
    }
    if (unit.retrieve.length < 1 || unit.retrieve.some((ref) => !questionIds.has(ref))) {
      structureIssues.push(`${unit.unitId}: retrieve refs missing or dangling`);
    }
    if (!unit.anchor?.template) structureIssues.push(`${unit.unitId}: no anchor`);
    if ((unit.content?.narration ?? []).length === 0) {
      structureIssues.push(`${unit.unitId}: empty narration`);
    }
    const cards = unit.content?.cards ?? [];
    if (cards.length === 0) structureIssues.push(`${unit.unitId}: no cards`);
    const genericFlags = cards.map((card) => GENERIC_TEMPLATES.has(card.template));
    const cap = Math.max(1, Math.floor(cards.length / 3));
    if (genericFlags.filter(Boolean).length > cap) {
      structureIssues.push(`${unit.unitId}: generic-card ratio over the 1-in-3 cap`);
    }
    for (let i = 1; i < genericFlags.length; i++) {
      if (genericFlags[i] && genericFlags[i - 1]) {
        structureIssues.push(`${unit.unitId}: consecutive generic cards`);
        break;
      }
    }
  }
  if (structureIssues.length > 0) failures.push(...structureIssues);

  // 2. Compliance invariants. Only compliance-critical flag codes fail the
  //    eval; everything else the judge raised is surfaced as gate-2 review
  //    material (that is what the gate is for).
  const FAILING_FLAG_CODES = new Set(["unsupported-claim", "banned-claim"]);
  const complianceIssues = [];
  const reviewFlags = [];
  let errorFlags = 0;
  let warningFlags = 0;
  for (const unit of courseRows.units) {
    const flags = unit.qa?.flags ?? [];
    for (const flag of flags) {
      if (flag.severity === "error") errorFlags += 1;
      else warningFlags += 1;
      if (FAILING_FLAG_CODES.has(flag.code)) {
        complianceIssues.push(`${unit.unitKey}: [${flag.code}] ${flag.message}`);
      } else {
        reviewFlags.push(
          `${unit.unitKey}: [${flag.code}/${flag.severity}] ${flag.message}`
        );
      }
    }
    if (!unit.qa) complianceIssues.push(`${unit.unitKey}: never judged`);
  }
  for (const flag of courseQa?.courseFlags ?? []) {
    if (flag.code === "excluded-fact-leak") {
      complianceIssues.push(`EXCLUDED-FACT LEAK: ${flag.message}`);
    } else if (FAILING_FLAG_CODES.has(flag.code)) {
      complianceIssues.push(`course: [${flag.code}] ${flag.message}`);
    } else if (flag.severity === "error") {
      errorFlags += 1;
      reviewFlags.push(`course: [${flag.code}/${flag.severity}] ${flag.message}`);
    }
  }
  for (const unit of compiledUnits) {
    for (const card of unit.content?.cards ?? []) {
      if (STAT_TEMPLATES.has(card.template)) {
        const label = card.props?.sourceLabel;
        if (typeof label !== "string" || label.trim() === "") {
          complianceIssues.push(`${unit.unitId}: ${card.template} without sourceLabel`);
        }
      }
    }
  }
  if (complianceIssues.length > 0) failures.push(...complianceIssues);
  if (reviewFlags.length > 0) {
    warnings.push(
      `${reviewFlags.length} judge flag(s) for human review at gate 2`
    );
  }

  // 3. Media (M6, pass/fail): every assetRef must resolve to a cleared,
  //    kind/aspect-correct catalogue asset (zero unknown-rights leakage,
  //    mechanically re-checked against the live library) and the pacing
  //    rule must hold wherever the cleared catalogue made it satisfiable.
  //    judge `media-irrelevant` flags surface via reviewFlags (not scored).
  const mediaIssues = [];
  for (const unit of mediaReport.units) {
    for (const violation of unit.refViolations) {
      mediaIssues.push(`${unit.unitKey}: ${violation}`);
    }
    for (const violation of unit.pacingViolations) {
      mediaIssues.push(`${unit.unitKey}: ${violation}`);
    }
  }
  if (mediaIssues.length > 0) failures.push(...mediaIssues);
  const mediaIrrelevantCount = reviewFlags.filter((flag) =>
    flag.includes("[media-irrelevant")
  ).length;

  return {
    pass: failures.length === 0,
    mediaIssues,
    mediaIrrelevantCount,
    compiledConcepts: compiledUnits.map((unit) => unit.concept),
    compiledModuleCount: definition.modules.length,
    goldenModuleCount: golden.modules.length,
    modulesPass,
    structureIssues,
    complianceIssues,
    reviewFlags,
    errorFlags,
    warningFlags,
    failures,
    warnings,
  };
}

// --- Judge eval (seeded known-bad courses) ---

async function runJudgeEval() {
  const cases = [
    { kind: "hallucinated-fact", expect: "flagged-status" },
    { kind: "provenance-stripped", expect: "flagged-status" },
    { kind: "redundant-card", expect: "redundant-card-flag" },
  ];
  const results = [];
  for (const testCase of cases) {
    console.log(`\n— judge eval: ${testCase.kind}`);
    const { runId } = await convexRun("pipeline/compiler/judgeEval:seedBadCourse", {
      kind: testCase.kind,
    });
    const verdict = await convexRun("pipeline/compiler/judge:runQaJudge", { runId });
    if (verdict.status === "failed") {
      throw new Error(`judge failed on ${testCase.kind}: ${verdict.cause}`);
    }
    let caught;
    let detail;
    if (testCase.expect === "flagged-status") {
      caught = verdict.status === "flagged";
      detail = `verdict: ${verdict.status} (${verdict.errorCount} errors, ${verdict.warningCount} warnings)`;
    } else {
      const rows = await convexRun("pipeline/courses:getCourseForRunInternal", { runId });
      const flags = rows.units.flatMap((unit) => unit.qa?.flags ?? []);
      caught = flags.some((flag) => flag.code === "redundant-card");
      detail = `unit flags: ${flags.map((flag) => flag.code).join(", ") || "(none)"}`;
    }
    console.log(`  ${caught ? "CAUGHT" : "MISSED"} — ${detail}`);
    results.push({ kind: testCase.kind, caught, verdict: verdict.status });
  }
  return results;
}

// --- Main ---

async function main() {
  console.log("== CounselIQ compiler eval ==\n");

  const golden = JSON.parse(readFileSync(GOLDEN_FILE, "utf8"));
  const goldenUnitCount = golden.modules.reduce(
    (sum, module) => sum + module.microUnits.length,
    0
  );

  const estimate = await convexRun("pipeline/llmCalls:estimateCompileCost", {
    units: goldenUnitCount,
    avgTokensInPerUnit: CONFIG.avgTokensInPerUnit ?? 6000,
    avgTokensOutPerUnit: CONFIG.avgTokensOutPerUnit ?? 2500,
  });
  console.log(`Models: ${JSON.stringify(estimate.models)}`);
  console.log(
    `Estimated compile+judge cost (~${goldenUnitCount} units): ` +
      (estimate.estimateUsd !== null
        ? `$${estimate.estimateUsd.toFixed(4)} (price sheet verified ${estimate.priceSheetVerifiedAt})`
        : "unknown — model missing from llm/pricing.ts") +
      (JUDGE_ONLY ? " — judge-only run uses a fraction of this" : "")
  );
  if (!YES) {
    console.error("\nThis run costs real money. Re-run with --yes to proceed.");
    process.exit(1);
  }

  let judgeEvalResults = null;
  if (JUDGE_ONLY) {
    judgeEvalResults = await runJudgeEval();
    const allCaught = judgeEvalResults.every((result) => result.caught);
    appendFileSync(
      HISTORY_FILE,
      JSON.stringify({
        at: new Date().toISOString(),
        kind: "compile-judge",
        judgeEval: judgeEvalResults,
        pass: allCaught,
      }) + "\n"
    );
    console.log(`\nAppended to eval-history.jsonl`);
    if (!allCaught) {
      console.error("\nJUDGE EVAL FAILED — not every seeded defect was caught");
      process.exit(1);
    }
    console.log("\nJUDGE EVAL PASSED — all three seeded defects caught");
    return;
  }

  // --- Obtain a compiled, judged run at gate 2 ---
  let runId;
  if (REUSE) {
    const runs = await convexRun("pipeline/queries:listRunsByStateInternal", {
      state: "GATE_2_COURSE_REVIEW",
    });
    const candidate = runs.find((run) => run.courseId);
    if (!candidate) {
      throw new Error("--reuse: no run currently parked at GATE_2_COURSE_REVIEW");
    }
    runId = candidate._id;
    console.log(`\nReusing run at gate 2: ${runId}`);
  } else {
    console.log("");
    // The fixture docs are the golden fixture's institution's material —
    // seed under that name so branding is consistent end to end.
    runId = await driveFreshRun(CONFIG.compileInstitutionName ?? "La Trobe University");
  }

  // --- Collect + score ---
  const definition = await convexRun(
    "pipeline/courses:getCourseDefinitionForRunInternal",
    { runId }
  );
  if (!definition) throw new Error("run has no compiled course");
  const courseRows = await convexRun("pipeline/courses:getCourseForRunInternal", {
    runId,
  });
  const { run } = await convexRun("pipeline/queries:getRunInternal", { runId });
  const cost = await convexRun("pipeline/llmCalls:getRunCostInternal", { runId });
  const mediaReport = await convexRun("pipeline/assetsCatalogue:getRunMediaReport", {
    runId,
  });

  const score = scoreCourse(golden, definition, courseRows, mediaReport);

  const compiledUnitCount = definition.modules.reduce(
    (sum, module) => sum + module.microUnits.length,
    0
  );
  console.log(
    `\n== Scores (golden fixture #1 "${golden.courseTitle}" as FORMAT reference only) ==`
  );
  console.log(
    `  compiled concepts (informational): ${score.compiledConcepts.join(" | ")}`
  );
  console.log(
    `  structure: ${definition.modules.length} modules (golden ${score.goldenModuleCount}, ±1) ` +
      `${score.modulesPass ? "ok" : "FAIL"}; ${compiledUnitCount} units; ` +
      `${score.structureIssues.length === 0 ? "all units well-formed ok" : `${score.structureIssues.length} issue(s) FAIL`}`
  );
  for (const issue of score.structureIssues) console.log(`    ${issue}`);
  console.log(
    `  compliance: ${score.complianceIssues.length === 0 ? "no unsupported/banned claims, stat cards sourced, no leaks ok" : `${score.complianceIssues.length} issue(s) FAIL`}` +
      ` (${score.errorFlags} error / ${score.warningFlags} warning judge flags)`
  );
  for (const issue of score.complianceIssues) console.log(`    ${issue}`);
  console.log(
    `  media: ${score.mediaIssues.length === 0 ? "all assetRefs cleared + kind/aspect-correct, pacing satisfied ok" : `${score.mediaIssues.length} issue(s) FAIL`}` +
      ` (library: ${mediaReport.availability.images} image(s) + ${mediaReport.availability.videos} video(s) cleared)`
  );
  for (const issue of score.mediaIssues) console.log(`    ${issue}`);
  console.log(
    `  media stats: ${mediaReport.mediaCards} media card(s), ` +
      `${mediaReport.distinctAssets} distinct asset(s) used, ` +
      `${mediaReport.videoCards} video card(s), ` +
      `${score.mediaIrrelevantCount} media-irrelevant judge flag(s)`
  );
  if (score.reviewFlags.length > 0) {
    console.log(`  gate-2 review flags (not scored):`);
    for (const flag of score.reviewFlags) console.log(`    ${flag}`);
  }
  for (const warning of score.warnings) console.log(`  WARN ${warning}`);

  console.log(`\nPrompt versions: ${JSON.stringify(run.promptVersions)}`);
  console.log(
    `Cost: $${cost.totalUsd.toFixed(4)} across ${cost.totalCalls} calls` +
      (estimate.estimateUsd !== null
        ? ` (estimated $${estimate.estimateUsd.toFixed(4)})`
        : "")
  );
  for (const row of cost.byStage) {
    console.log(`  ${row.stage} [${row.model}]: $${row.costUsd.toFixed(4)} / ${row.calls} call(s)`);
  }
  console.log(`  $/course: $${cost.totalUsd.toFixed(4)}`);

  appendFileSync(
    HISTORY_FILE,
    JSON.stringify({
      at: new Date().toISOString(),
      kind: "compile",
      runId,
      promptVersions: run.promptVersions,
      compiledConcepts: score.compiledConcepts,
      moduleCount: definition.modules.length,
      unitCount: compiledUnitCount,
      structureIssues: score.structureIssues,
      complianceIssues: score.complianceIssues,
      mediaIssues: score.mediaIssues,
      mediaStats: {
        mediaCards: mediaReport.mediaCards,
        videoCards: mediaReport.videoCards,
        distinctAssets: mediaReport.distinctAssets,
        availability: mediaReport.availability,
        mediaIrrelevantFlags: score.mediaIrrelevantCount,
      },
      reviewFlags: score.reviewFlags,
      judgeFlags: { errors: score.errorFlags, warnings: score.warningFlags },
      costUsd: cost.totalUsd,
      estimatedUsd: estimate.estimateUsd,
      pass: score.pass,
    }) + "\n"
  );
  console.log(`\nAppended to eval-history.jsonl`);

  if (!score.pass) {
    console.error("\nCOMPILE EVAL FAILED");
    process.exit(1);
  }
  console.log("\nCOMPILE EVAL PASSED");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
