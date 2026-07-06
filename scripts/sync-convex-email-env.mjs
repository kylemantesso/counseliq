#!/usr/bin/env node

/**
 * Push Resend-related env vars to the linked Convex deployment.
 *
 * Manual: RESEND_API_KEY=re_... npm run env:sync:convex-email
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function resolveEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  return null;
}

function runConvexEnvSet(key, value) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["convex", "env", "set", key, value], {
      cwd: ROOT,
      stdio: "inherit",
      shell: false,
      env: process.env,
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`convex env set ${key} failed`))
    );
  });
}

async function main() {
  const resendApiKey = resolveEnv("RESEND_API_KEY");
  const entries = [
    resendApiKey ? ["RESEND_API_KEY", resendApiKey] : null,
    ["RESEND_FROM", resolveEnv("RESEND_FROM") ?? "App Template <notifications@example.com>"],
    [
      "APP_WEB_ORIGIN",
      resolveEnv("APP_WEB_ORIGIN", "NEXT_PUBLIC_APP_WEB_ORIGIN") ??
        "http://localhost:3000",
    ],
    ["RESEND_TEST_MODE", resolveEnv("RESEND_TEST_MODE") ?? "false"],
  ].filter(Boolean);

  if (!resendApiKey) {
    console.warn(
      "RESEND_API_KEY not found in environment — skipping secret sync."
    );
    console.warn("Set RESEND_API_KEY and re-run: npm run env:sync:convex-email");
  }

  for (const entry of entries) {
    const [key, value] = entry;
    try {
      await runConvexEnvSet(key, value);
      console.log(`Set Convex env ${key}.`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
