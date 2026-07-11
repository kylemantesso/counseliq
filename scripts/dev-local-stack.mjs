#!/usr/bin/env node

/**
 * One-command local M2 stack:
 *
 *   npm run dev:stack
 *
 * Brings up, in order:
 *   1. MinIO + converter (docker compose, services/converter)
 *   2. A LOCAL anonymous Convex deployment (cloud dev can't reach localhost)
 *      with all ingestion env vars set
 *   3. `npx convex dev` + the Next.js web app pointed at the local deployment
 *
 * While the stack runs, .env.local points at the local deployment (the convex
 * CLI rewrites it); it is restored to its original contents on Ctrl-C/exit.
 * Your cloud dev deployment itself is untouched.
 *
 * Then, in another terminal:
 *   npm run walkthrough:local        # e2e run against this stack
 *   open http://localhost:3005/admin/source-docs
 *
 * Options (env vars):
 *   CONVERTER_PORT=8090   host port for the converter (default 8090)
 *   RENDERER_PORT=8081    host port for the renderer (default 8081)
 *   CONVERTER_REBUILD=1   rebuild converter image (default: reuse existing image)
 *   WEB_PORT=3005         port for the web dev server (default 3005)
 *   ADMIN_EMAILS=you@x.y  grant admin to your login on the local deployment
 */

import { spawn, spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPOSE_FILE = "services/converter/docker-compose.yml";
// Separate env file so `convex dev` never rewrites the real .env.local
// (which points at the cloud dev deployment).
const LOCAL_ENV_FILE = ".env.convex-local";

// Anonymous local deployment name is derived from the repo directory.
const LOCAL_DEPLOYMENT = "anonymous:anonymous-counsel-iq";
const LOCAL_CONVEX_URL = "http://127.0.0.1:3210";
const LOCAL_CONVEX_SITE_URL = "http://127.0.0.1:3211";

const CONVERTER_PORT = process.env.CONVERTER_PORT ?? "8090";
const RENDERER_PORT = process.env.RENDERER_PORT ?? "8081";
const WEB_PORT = process.env.WEB_PORT ?? "3005";
const CALLBACK_SECRET =
  process.env.CONVERTER_CALLBACK_SECRET ?? "local-dev-secret";
const RENDERER_CALLBACK_SECRET =
  process.env.RENDERER_CALLBACK_SECRET ?? CALLBACK_SECRET;

const convexEnv = { ...process.env, CONVEX_DEPLOYMENT: LOCAL_DEPLOYMENT };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: options.quiet ? "pipe" : "inherit",
    env: options.env ?? process.env,
  });
  if (result.status !== 0) {
    const detail = options.quiet
      ? `\n${result.stdout}\n${result.stderr}`
      : "";
    throw new Error(`${command} ${args.join(" ")} failed${detail}`);
  }
  return result;
}

/**
 * Reads a var from the repo-root .env.local as a fallback for values not
 * exported in the shell (e.g. OPENROUTER_API_KEY lives there, not in env).
 */
function rootEnvLocalValue(key) {
  try {
    const envFile = readFileSync(path.join(ROOT, ".env.local"), "utf8");
    const match = envFile.match(
      new RegExp(`^${key}=(.*)$`, "m")
    );
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/** Clerk publishable keys encode the frontend API host in base64. */
function clerkIssuerFromWebEnv() {
  try {
    const envFile = readFileSync(
      path.join(ROOT, "apps/admin-web/.env.local"),
      "utf8"
    );
    const match = envFile.match(
      /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_(?:test|live)_([A-Za-z0-9+/=]+)/
    );
    if (!match) return null;
    const host = Buffer.from(match[1], "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    return `https://${host}`;
  } catch {
    return null;
  }
}

async function waitForConverter() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${CONVERTER_PORT}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Converter did not become healthy within 60s");
}

function setConvexEnvVars() {
  const vars = {
    OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
    OBJECT_STORE_REGION: "us-east-1",
    OBJECT_STORE_BUCKET: "counseliq-ingestion",
    OBJECT_STORE_ACCESS_KEY_ID: "minioadmin",
    OBJECT_STORE_SECRET_ACCESS_KEY: "minioadmin",
    CONVERTER_URL: `http://127.0.0.1:${CONVERTER_PORT}`,
    CONVERTER_CALLBACK_SECRET: CALLBACK_SECRET,
    // The converter runs in Docker and reaches the host's local deployment
    // via host.docker.internal.
    CONVERTER_CALLBACK_URL: `http://host.docker.internal:3211/converter/callback`,
    RENDERER_URL: `http://127.0.0.1:${RENDERER_PORT}`,
    RENDERER_CALLBACK_SECRET,
    RENDERER_CALLBACK_URL: `${LOCAL_CONVEX_SITE_URL}/renderer/callback`,
  };

  const issuer = clerkIssuerFromWebEnv();
  if (issuer) {
    vars.CLERK_JWT_ISSUER_DOMAIN = issuer;
  } else {
    console.warn(
      "! Could not derive CLERK_JWT_ISSUER_DOMAIN from apps/admin-web/.env.local — set it manually if the push fails."
    );
  }
  if (process.env.ADMIN_EMAILS) {
    vars.ADMIN_EMAILS = process.env.ADMIN_EMAILS;
  }
  // LLM extraction (M3). Forward when present (shell env wins over the
  // repo-root .env.local); an already-set value on the local deployment
  // persists across stack restarts either way.
  for (const key of [
    "OPENROUTER_API_KEY",
    "MODEL_EXTRACT_PAGE",
    "MODEL_MERGE_INVENTORY",
    "MODEL_INFER_THEME",
    "EXTRACTION_PARALLELISM",
    "EXTRACTION_MODE",
    // TTS synthesis (M5). Same precedence: shell env wins over .env.local.
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "TTS_PROVIDER",
    "TTS_MODEL",
    "TTS_PARALLELISM",
    "TTS_MODE",
  ]) {
    const value = process.env[key] ?? rootEnvLocalValue(key);
    if (value) {
      vars[key] = value;
    }
  }
  if (!vars.OPENROUTER_API_KEY) {
    console.warn(
      "! OPENROUTER_API_KEY not found in the shell env or .env.local — EXTRACTING will fail until it is set on the local deployment."
    );
  }
  if (!vars.ELEVENLABS_API_KEY && vars.TTS_PROVIDER !== "mock") {
    console.warn(
      "! ELEVENLABS_API_KEY not found and TTS_PROVIDER is not 'mock' — GENERATING_ASSETS will fail until one is set (tip: TTS_PROVIDER=mock npm run dev:stack for a free rehearsal)."
    );
  }

  for (const [key, value] of Object.entries(vars)) {
    run("npx", ["convex", "env", "set", `${key}=${value}`], {
      env: convexEnv,
      quiet: true,
    });
  }
  console.log(
    `✓ Local Convex deployment configured (${Object.keys(vars).length} env vars)`
  );
}

function prefixStream(stream, prefix) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) console.log(`${prefix} ${line}`);
  });
}

function snapshotEnvLocal() {
  try {
    return readFileSync(path.join(ROOT, ".env.local"), "utf8");
  } catch {
    return null;
  }
}

function restoreEnvLocal(contents) {
  if (contents === null) return;
  const current = snapshotEnvLocal();
  if (current !== contents) {
    writeFileSync(path.join(ROOT, ".env.local"), contents);
    console.log("✓ Restored .env.local (cloud dev deployment)");
  }
}

async function main() {
  console.log("== CounselIQ local stack ==\n");

  const envLocalBackup = snapshotEnvLocal();

  const composeArgs = ["compose", "-f", COMPOSE_FILE, "up", "-d"];
  if (process.env.CONVERTER_REBUILD === "1") {
    composeArgs.push("--build");
    console.log("Starting MinIO + converter (docker compose, rebuilding)…");
  } else {
    console.log(
      "Starting MinIO + converter (docker compose, existing image)…"
    );
    console.log(
      "  tip: CONVERTER_REBUILD=1 npm run dev:stack to force a rebuild"
    );
  }
  run("docker", composeArgs, {
    env: {
      ...process.env,
      CONVERTER_PORT,
      CONVERTER_CALLBACK_SECRET: CALLBACK_SECRET,
    },
  });
  await waitForConverter();
  console.log(`✓ Converter healthy on :${CONVERTER_PORT}, MinIO on :9000\n`);

  // Persist local deployment config in a dedicated env file so convex dev
  // doesn't rewrite .env.local (which points at cloud dev).
  writeFileSync(
    path.join(ROOT, LOCAL_ENV_FILE),
    [
      `CONVEX_DEPLOYMENT=${LOCAL_DEPLOYMENT}`,
      `NEXT_PUBLIC_CONVEX_URL=${LOCAL_CONVEX_URL}`,
      `CONVEX_SITE_URL=${LOCAL_CONVEX_SITE_URL}`,
      "",
    ].join("\n")
  );

  console.log("Configuring local Convex deployment…");
  setConvexEnvVars();

  console.log(`\nStarting convex dev + renderer + web (http://localhost:${WEB_PORT})…`);
  console.log(
    `  admin page:  http://localhost:${WEB_PORT}/admin/source-docs\n` +
      `  walkthrough: npm run walkthrough:local (in another terminal)\n` +
      (process.env.ADMIN_EMAILS
        ? ""
        : `  tip: ADMIN_EMAILS=you@example.com npm run dev:stack grants your login admin\n`)
  );

  const convexDev = spawn(
    "npx",
    ["convex", "dev", "--tail-logs", "always", "--env-file", LOCAL_ENV_FILE],
    { cwd: ROOT, env: convexEnv }
  );
  const webDev = spawn("npm", ["run", "dev", "--workspace=@counseliq/admin-web"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_CONVEX_URL: LOCAL_CONVEX_URL,
      NEXT_PUBLIC_CONVEX_SITE_URL: LOCAL_CONVEX_SITE_URL,
      PORT: WEB_PORT,
    },
  });
  const rendererDev = spawn("npm", ["run", "dev", "--workspace=@counseliq/renderer"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: RENDERER_PORT,
      RENDERER_CALLBACK_SECRET,
      OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
      OBJECT_STORE_REGION: "us-east-1",
      OBJECT_STORE_BUCKET: "counseliq-ingestion",
      OBJECT_STORE_ACCESS_KEY_ID: "minioadmin",
      OBJECT_STORE_SECRET_ACCESS_KEY: "minioadmin",
    },
  });

  prefixStream(convexDev.stdout, "[convex]");
  prefixStream(convexDev.stderr, "[convex]");
  prefixStream(webDev.stdout, "[web]");
  prefixStream(webDev.stderr, "[web]");
  prefixStream(rendererDev.stdout, "[renderer]");
  prefixStream(rendererDev.stderr, "[renderer]");

  const shutdown = () => {
    console.log("\nShutting down…");
    convexDev.kill("SIGINT");
    webDev.kill("SIGINT");
    rendererDev.kill("SIGINT");
    spawnSync("docker", ["compose", "-f", COMPOSE_FILE, "stop"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    restoreEnvLocal(envLocalBackup);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  for (const child of [convexDev, webDev, rendererDev]) {
    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`A stack process exited with code ${code}`);
        shutdown();
      }
    });
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
