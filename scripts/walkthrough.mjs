#!/usr/bin/env node

/**
 * M1 exit test: drive a pipeline run end-to-end against the dev deployment.
 *
 * seed -> startRun -> poll getRun printing each state change -> decideGate
 * at gates 1/2/3 as reached -> exit on PUBLISHED printing the full runEvents
 * history.
 *
 * Usage: npm run walkthrough (requires `npx convex dev` to have been run once
 * so the project is linked to a dev deployment).
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const GATE_STATES = {
  GATE_1_KNOWLEDGE_REVIEW: 1,
  GATE_2_QUIZ_REVIEW: 2,
  GATE_3_PREVIEW: 3,
};

const POLL_INTERVAL_MS = 1000;
const TIMEOUT_MS = 3 * 60 * 1000;

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

async function main() {
  console.log("== CounselIQ M1 walkthrough ==\n");

  console.log("Seeding institution…");
  const institutionId = await convexRun("pipeline/seed:seed");
  console.log(`  institution: ${institutionId}`);

  console.log("Starting run…");
  const runId = await convexRun("pipeline/runs:startRun", { institutionId });
  console.log(`  run: ${runId}\n`);

  const decidedGates = new Set();
  let lastState = null;
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
      return;
    }

    const gate = GATE_STATES[run.state];
    if (gate && !decidedGates.has(gate)) {
      decidedGates.add(gate);
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
