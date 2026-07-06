#!/usr/bin/env node

/**
 * Project init CLI: bootstraps a new project from this template.
 *
 * Interactively prompts for API tokens (or reads CONVEX_TOKEN / VERCEL_TOKEN /
 * CLERK_PLATFORM_API_KEY from the environment), then creates Convex, Vercel,
 * and Clerk projects and writes local env files.
 *
 * Usage:
 *   node scripts/init.mjs              create projects, rename, deploy
 *   node scripts/init.mjs --deploy     deploy only (Convex + Vercel)
 *
 * Or: npm run init   /   npm run deploy
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, execSync } from "child_process";
import { createPrompter } from "./lib/init-prompts.mjs";
import { setupClerkAutomatically } from "./lib/init-clerk.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INIT_AUTH_DIR = path.join(ROOT, ".init", "auth");

const CLERK_JWT_ISSUER_PLACEHOLDER = "https://placeholder.clerk.accounts.dev";

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function compact(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const useShell = opts.shell !== false;
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      stdio: opts.stdio ?? "pipe",
      shell: useShell,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    let out = "";
    let err = "";
    if (child.stdout) child.stdout.on("data", (d) => (out += d.toString()));
    if (child.stderr) child.stderr.on("data", (d) => (err += d.toString()));
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(err || out || `exit ${code}`));
    });
  });
}

async function preflightChecks(authMode) {
  if (authMode === "none") return;
  if (authMode === "google" || authMode === "all") {
    try {
      await run("gcloud", ["--version"]);
    } catch (e) {
      console.error("Google auth requires gcloud CLI. Install: https://cloud.google.com/sdk/docs/install");
      process.exit(1);
    }
  }
  if (authMode === "apple" || authMode === "all") {
    // Optional: fastlane for Apple. Don't fail if missing; we have manual checklist.
  }
}

async function setVercelEnvVar(projectName, vercelToken, key, value) {
  try {
    await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectName)}/env`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key,
        value,
        type: "plain",
        target: ["production", "preview", "development"],
      }),
    });
  } catch (error) {
    console.warn(`Vercel env var ${key} failed (continuing):`, error.message);
  }
}

async function setConvexEnvVar(key, value, { convexUrl, deployKey, env = process.env } = {}) {
  const args = ["convex", "env", "set", key, value];
  if (convexUrl) args.push("--url", convexUrl);
  if (deployKey) args.push("--admin-key", deployKey);

  await new Promise((resolve, reject) => {
    const child = spawn("npx", args, {
      cwd: ROOT,
      stdio: "pipe",
      shell: false,
      env,
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`convex env set ${key} failed`))
    );
  });
}

async function prepareConvexAuthEnv(clerkConfig, { convexUrl, deployKey, convexDeployEnv }) {
  const jwtIssuer = clerkConfig?.jwtIssuerDomain ?? CLERK_JWT_ISSUER_PLACEHOLDER;

  if (!clerkConfig?.jwtIssuerDomain) {
    console.warn(
      "\n  Clerk was skipped — using placeholder CLERK_JWT_ISSUER_DOMAIN for deploy.",
      "Update it in the Convex dashboard after adding Clerk.\n"
    );
  }

  console.log("Setting CLERK_JWT_ISSUER_DOMAIN on Convex (required before deploy)...");
  await setConvexEnvVar("CLERK_JWT_ISSUER_DOMAIN", jwtIssuer, {
    convexUrl,
    deployKey,
    env: convexDeployEnv,
  });
  console.log("  CLERK_JWT_ISSUER_DOMAIN set.");
}

async function writeConvexDeploymentLink({ deploymentName, convexUrl }) {
  if (!deploymentName && !convexUrl) return;

  const lines = [];
  if (deploymentName) lines.push(`CONVEX_DEPLOYMENT=${deploymentName}`);
  if (convexUrl) lines.push(`NEXT_PUBLIC_CONVEX_URL=${convexUrl}`);

  await fs.writeFile(path.join(ROOT, ".env.local"), lines.join("\n") + "\n");
  console.log("Wrote .env.local (Convex deployment link)");
}

async function runDeployOnly(prompter) {
  console.log("Deploy only – Convex + Vercel\n");

  const vercelToken = await prompter.promptToken("Vercel token", {
    envVar: "VERCEL_TOKEN",
    helpText: ["Create one at https://vercel.com/account/tokens"],
  });

  console.log("Deploying to Convex...");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("npx", ["convex", "deploy"], {
        cwd: ROOT,
        stdio: "inherit",
        shell: true,
      });
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("convex deploy failed"))
      );
    });
    console.log("Convex deploy done.");
  } catch (e) {
    console.error("Convex deploy failed:", e.message);
    process.exit(1);
  }

  console.log("\nDeploying to Vercel...");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        "npx",
        ["vercel", "deploy", "--prod", "--yes"],
        {
          cwd: ROOT,
          stdio: "inherit",
          shell: true,
          env: { ...process.env, VERCEL_TOKEN: vercelToken },
        }
      );
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("vercel deploy failed"))
      );
    });
    console.log("Vercel deploy done.");
  } catch (e) {
    console.error("Vercel deploy failed:", e.message);
    process.exit(1);
  }

  console.log("\nDone.");
}

async function runAuthOnly() {
  console.log("Add OAuth (Google + Apple) – run after init\n");

  const pkgPath = path.join(ROOT, "package.json");
  let slug = "my-app";
  let displayName = "My App";
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    if (pkg.name) {
      slug = slugify(pkg.name) || slug;
      displayName = (pkg.name || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || displayName;
    }
  } catch {
    // use defaults
  }

  let bundlePrefix = "com." + slug.replace(/-/g, "");
  const appJsonPath = path.join(ROOT, "apps/mobile/app.json");
  try {
    const appJson = JSON.parse(await fs.readFile(appJsonPath, "utf8"));
    const bid = appJson?.expo?.ios?.bundleIdentifier || "";
    if (bid.endsWith(".mobile")) bundlePrefix = bid.slice(0, -7);
  } catch {
    // use default
  }

  let vercelProjectUrl = null;
  for (const dir of [ROOT, path.join(ROOT, "apps/web")]) {
    const vercelProjectPath = path.join(dir, ".vercel", "project.json");
    try {
      const v = JSON.parse(await fs.readFile(vercelProjectPath, "utf8"));
      const pname = v.projectName || v.name;
      if (pname) {
        vercelProjectUrl = `https://${pname}.vercel.app`;
        break;
      }
    } catch {
      // try next location
    }
  }
  if (!vercelProjectUrl) {
    const custom = await question("Vercel project URL (e.g. https://my-app.vercel.app) or Enter to use localhost only: ").then((s) => s.trim());
    if (custom) vercelProjectUrl = custom;
  }

  await preflightChecks("all");
  console.log("Using: slug=" + slug + ", bundlePrefix=" + bundlePrefix + ", displayName=" + displayName);

  const googleAuth = await runGoogleProvisioning(slug, displayName, vercelProjectUrl);
  const appleAuth = await runAppleProvisioning(slug, bundlePrefix);

  const webEnvPath = path.join(ROOT, "apps/web/.env.local");
  const mobileEnvPath = path.join(ROOT, "apps/mobile/.env");
  const webLines = [];
  const mobileLines = [];
  if (googleAuth) {
    webLines.push(`NEXT_PUBLIC_GOOGLE_CLIENT_ID=${googleAuth.webClientId}`);
    mobileLines.push(`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${googleAuth.webClientId}`);
    if (googleAuth.androidClientId) mobileLines.push(`EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=${googleAuth.androidClientId}`);
    if (googleAuth.iosClientId) mobileLines.push(`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=${googleAuth.iosClientId}`);
  }
  if (appleAuth) {
    webLines.push(`NEXT_PUBLIC_APPLE_SERVICE_ID=${appleAuth.serviceId}`);
    mobileLines.push(`EXPO_PUBLIC_APPLE_SERVICE_ID=${appleAuth.serviceId}`);
  }

  for (const line of webLines) {
    const existing = await fs.readFile(webEnvPath, "utf8").catch(() => "");
    if (!existing.includes(line.split("=")[0])) {
      await fs.appendFile(webEnvPath, (existing.endsWith("\n") ? "" : "\n") + line + "\n");
    }
  }
  for (const line of mobileLines) {
    const existing = await fs.readFile(mobileEnvPath, "utf8").catch(() => "");
    if (!existing.includes(line.split("=")[0])) {
      await fs.appendFile(mobileEnvPath, (existing.endsWith("\n") ? "" : "\n") + line + "\n");
    }
  }
  console.log("Appended OAuth vars to apps/web/.env.local and apps/mobile/.env");

  const vercelToken = process.env.VERCEL_TOKEN;
  if (vercelToken && (googleAuth || appleAuth)) {
    const projectName = vercelProjectUrl ? new URL(vercelProjectUrl).hostname.split(".")[0] : slug;
    if (googleAuth) {
      try {
        await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectName)}/env`, {
          method: "POST",
          headers: { Authorization: `Bearer ${vercelToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ key: "NEXT_PUBLIC_GOOGLE_CLIENT_ID", value: googleAuth.webClientId, type: "plain", target: ["production", "preview", "development"] }),
        });
      } catch (e) {
        console.warn("Vercel Google env failed:", e.message);
      }
    }
    if (appleAuth) {
      try {
        await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectName)}/env`, {
          method: "POST",
          headers: { Authorization: `Bearer ${vercelToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ key: "NEXT_PUBLIC_APPLE_SERVICE_ID", value: appleAuth.serviceId, type: "plain", target: ["production", "preview", "development"] }),
        });
      } catch (e) {
        console.warn("Vercel Apple env failed:", e.message);
      }
    }
    console.log("Set OAuth env on Vercel project.");
  }

  try {
    const appJson = JSON.parse(await fs.readFile(appJsonPath, "utf8"));
    const expo = appJson.expo || {};
    if (!expo.plugins) expo.plugins = [];
    if (!expo.plugins.includes("expo-apple-authentication")) {
      expo.plugins.push("expo-apple-authentication");
      appJson.expo = expo;
      await fs.writeFile(appJsonPath, JSON.stringify(appJson, null, 2));
      console.log("Added expo-apple-authentication to app.json");
    }
  } catch (e) {
    console.warn("app.json update:", e.message);
  }

  const convexEnv = process.env;
  if (googleAuth?.webClientSecret) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn("npx", ["convex", "env", "set", "GOOGLE_CLIENT_SECRET", googleAuth.webClientSecret], {
          cwd: ROOT,
          stdio: "pipe",
          shell: false,
          env: convexEnv,
        });
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("convex env set failed"))));
      });
      console.log("Set GOOGLE_CLIENT_SECRET in Convex.");
    } catch (e) {
      console.warn("Convex GOOGLE_CLIENT_SECRET:", e.message, "- set it in Convex dashboard if needed.");
    }
  }
  if (appleAuth?.privateKeyP8 && appleAuth.teamId && appleAuth.keyId) {
    const applePrivateKeyEscaped = appleAuth.privateKeyP8.replace(/\n/g, "\\n");
    for (const [key, val] of [
      ["APPLE_TEAM_ID", appleAuth.teamId],
      ["APPLE_KEY_ID", appleAuth.keyId],
      ["APPLE_PRIVATE_KEY", applePrivateKeyEscaped],
    ]) {
      try {
        await new Promise((resolve, reject) => {
          const child = spawn("npx", ["convex", "env", "set", key, val], {
            cwd: ROOT,
            stdio: "pipe",
            shell: false,
            env: convexEnv,
          });
          child.on("exit", (code) => (code === 0 ? resolve() : reject()));
        });
      } catch {
        // ignore
      }
    }
    console.log("Set APPLE_* in Convex.");
  } else if (appleAuth) {
    console.log("Apple: set APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY in Convex dashboard when you have the .p8 key.");
  }

  console.log("\nOAuth setup done. Redeploy Convex and Vercel if needed.");
}

function randomId(len = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function runGoogleProvisioning(slug, displayName, vercelProjectUrl) {
  const baseId = slug.replace(/-/g, "").slice(0, 30) || slug; // GCP project ID: letters, numbers, hyphens; 6-30 chars
  console.log("\n--- Google OAuth setup ---");

  const gcpProjectName = displayName.trim().slice(0, 100);
  let gcpProjectId = null;
  try {
    await run("gcloud", ["projects", "create", baseId, `--name=${gcpProjectName}`], { shell: false });
    gcpProjectId = baseId;
    console.log("Using GCP project ID:", gcpProjectId);
  } catch (e) {
    const inUse = e.message.includes("already in use") || e.message.includes("already exists");
    const quotaExceeded = e.message.includes("quota") || e.message.includes("QuotaFailure");
    if (inUse) {
      const fallbackId = baseId.slice(0, 22) + "-" + randomId(6);
      console.log("Project ID", baseId, "taken; trying", fallbackId);
      try {
        await run("gcloud", ["projects", "create", fallbackId, `--name=${gcpProjectName}`], { shell: false });
        gcpProjectId = fallbackId;
        console.log("Using GCP project ID:", gcpProjectId);
      } catch (e2) {
        const quota2 = e2.message.includes("quota") || e2.message.includes("QuotaFailure");
        console.warn("gcloud projects create:", e2.message);
        if (quota2) {
          console.log("\nYou've hit the GCP project quota. Use an existing project or request a quota increase.");
        }
      }
    } else {
      console.warn("gcloud projects create:", e.message);
      if (quotaExceeded) {
        console.log("\nYou've hit the GCP project quota. Use an existing project or request a quota increase.");
      }
    }
  }

  if (!gcpProjectId) {
    const existing = await question("Enter an existing GCP project ID to use for OAuth (or press Enter to skip Google setup): ").then((s) => s.trim());
    if (!existing) {
      console.log("Skipping Google OAuth setup.");
      return null;
    }
    gcpProjectId = existing;
    try {
      await run("gcloud", ["config", "set", "project", gcpProjectId], { shell: false });
    } catch (e) {
      console.warn("gcloud config set project:", e.message);
    }
  } else {
    try {
      await run("gcloud", ["config", "set", "project", gcpProjectId], { shell: false });
    } catch (e) {
      console.warn("gcloud config set project:", e.message);
    }
  }

  const consentUrl = `https://console.cloud.google.com/apis/credentials/consent?project=${gcpProjectId}`;
  const credentialsUrl = `https://console.cloud.google.com/apis/credentials?project=${gcpProjectId}`;
  const redirectUriProd = vercelProjectUrl ? `${vercelProjectUrl}/auth/callback` : null;
  const redirectUriLocal = "http://localhost:3000/auth/callback";

  console.log("\nOpening Cloud Console in your browser...");
  try {
    const open = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    execSync(`${open} "${consentUrl}"`, { stdio: "ignore" });
  } catch {
    // ignore
  }

  console.log("\n1. In the tab that opened: configure OAuth consent screen (External), set app name and support email, add your email as test user if needed. Save.");
  console.log("2. Then go to Credentials, Create credential > OAuth client ID > Web application.");
  console.log("   Add these Authorized redirect URIs:");
  if (redirectUriProd) console.log("   - " + redirectUriProd);
  console.log("   - " + redirectUriLocal);
  console.log("3. (Optional) Create credential > OAuth client ID > Android and/or iOS for mobile.\n");
  console.log("Credentials page: " + credentialsUrl);
  try {
    const open = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    execSync(`${open} "${credentialsUrl}"`, { stdio: "ignore" });
  } catch {
    // ignore
  }

  const webClientId = await question("\nPaste your Web application Client ID: ");
  const webClientSecret = await question("Paste your Web application Client secret: ");
  const androidClientId = await question("Android OAuth Client ID (optional, press Enter to skip): ").then((s) => s.trim() || null);
  const iosClientId = await question("iOS OAuth Client ID (optional, press Enter to skip): ").then((s) => s.trim() || null);

  if (!webClientId.trim()) {
    console.warn("No Web Client ID provided; skipping Google auth persistence.");
    return null;
  }

  await fs.mkdir(INIT_AUTH_DIR, { recursive: true });
  const data = {
    gcpProjectId,
    webClientId: webClientId.trim(),
    webClientSecret: webClientSecret.trim() || null,
    androidClientId,
    iosClientId,
  };
  await fs.writeFile(
    path.join(INIT_AUTH_DIR, "google.generated.json"),
    JSON.stringify(data, null, 2)
  );
  console.log("Saved to .init/auth/google.generated.json");
  return data;
}

async function runAppleProvisioning(slug, bundlePrefix) {
  console.log("\n--- Apple Sign In setup (semi-automated) ---");

  const teamId = await question("Apple Team ID (e.g. ABCD1234): ");
  const keyId = await question("Apple Key ID (Sign in with Apple key): ");
  const serviceId = await question("Apple Service ID for web (e.g. com.myapp.service): ").then((s) => s.trim() || `${bundlePrefix}.service`);
  const keyPath = await question("Path to .p8 private key file (or Enter to skip): ").then((s) => s.trim() || null);

  let privateKeyP8 = null;
  if (keyPath) {
    try {
      privateKeyP8 = await fs.readFile(keyPath, "utf8");
      privateKeyP8 = privateKeyP8.replace(/\r\n/g, "\n").trim();
    } catch (e) {
      console.warn("Could not read key file:", e.message);
    }
  }

  const checklist = `
Manual Apple steps (if not done yet):
1. developer.apple.com > Certificates, Identifiers & Profiles > Identifiers: create an App ID with "Sign in with Apple" capability (Bundle ID: ${bundlePrefix}.mobile).
2. Create a Services ID for web (e.g. ${serviceId}), enable "Sign in with Apple", configure domains and redirect URLs.
3. Create a Key with "Sign in with Apple" enabled; download the .p8 and note the Key ID.
4. Link the key to your primary App ID (or the Services ID) as needed.
`;
  console.log(checklist);

  const data = {
    teamId: teamId.trim(),
    keyId: keyId.trim(),
    serviceId: serviceId.trim(),
    bundleId: `${bundlePrefix}.mobile`,
    privateKeyP8,
  };
  await fs.mkdir(INIT_AUTH_DIR, { recursive: true });
  await fs.writeFile(
    path.join(INIT_AUTH_DIR, "apple.generated.json"),
    JSON.stringify({ ...data, privateKeyP8: data.privateKeyP8 ? "[REDACTED]" : null }, null, 2)
  );
  // Write actual key to a separate file that is gitignored
  if (privateKeyP8) {
    await fs.writeFile(path.join(INIT_AUTH_DIR, "apple_private_key.p8"), privateKeyP8);
    console.log("Saved key to .init/auth/apple_private_key.p8 (add .init/ to .gitignore)");
  }
  console.log("Saved metadata to .init/auth/apple.generated.json");
  return { ...data, privateKeyP8 };
}

async function main() {
  const prompter = createPrompter();

  try {
    if (DEPLOY_ONLY) {
      await runDeployOnly(prompter);
      return;
    }
    if (AUTH_ONLY) {
      console.log("OAuth init was removed — this template uses Clerk. See README for setup.");
      return;
    }

    console.log("Project init – Convex + Clerk + Vercel\n");
    console.log("This wizard creates cloud projects and writes local env files.");
    console.log("Press Enter to accept defaults shown in [brackets].\n");

    const convexToken = await prompter.promptToken("Convex deploy token", {
      envVar: "CONVEX_TOKEN",
      helpText: [
        "Convex Dashboard → Settings → Deploy Keys → Generate",
        "https://dashboard.convex.dev",
      ],
    });
    const vercelToken = await prompter.promptToken("Vercel token", {
      envVar: "VERCEL_TOKEN",
      helpText: ["https://vercel.com/account/tokens"],
    });

    const displayName = await prompter.question("Project display name (e.g. My Awesome App): ");
  if (!displayName.trim()) {
    console.error("Display name is required.");
    process.exit(1);
  }

  const slug = slugify(displayName);
  const compactName = compact(displayName);
  const defaultBundlePrefix = `com.${compactName}`;
  const bundlePrefix = await prompter
    .question(`Bundle ID prefix (e.g. com.mycompany) [${defaultBundlePrefix}]: `)
    .then((s) => (s.trim() ? s.trim() : defaultBundlePrefix));

  console.log("\nDerived:");
  console.log("  slug:", slug);
  console.log("  scope:", `@${slug}`);
  console.log("  bundle prefix:", bundlePrefix);
  console.log("");

  // --- Convex: get team ID then create project ---
  let convexUrl = null;
  let deploymentName = null;
  try {
    const tokenRes = await fetch("https://api.convex.dev/v1/token_details", {
      headers: { Authorization: `Bearer ${convexToken}` },
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(`Convex token_details failed: ${tokenRes.status} ${t}`);
    }
    const tokenData = await tokenRes.json();
    const teamId = tokenData.teamId;
    if (!teamId) {
      throw new Error("Convex token_details did not return teamId");
    }

    const createRes = await fetch(
      `https://api.convex.dev/v1/teams/${teamId}/create_project`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${convexToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectName: displayName.trim(),
          deploymentType: "dev",
        }),
      }
    );
    if (!createRes.ok) {
      const t = await createRes.text();
      throw new Error(`Convex create_project failed: ${createRes.status} ${t}`);
    }
    const createData = await createRes.json();
    convexUrl = createData.deploymentUrl || null;
    deploymentName = createData.deploymentName || null;
    if (convexUrl) {
      console.log("Convex project created. Deployment URL:", convexUrl);
    } else {
      console.log("Convex project created (no deployment URL in response).");
    }
  } catch (e) {
    console.error("Convex setup failed:", e.message);
    process.exit(1);
  }

  // --- Vercel: create project ---
  let vercelProjectUrl = null;
  try {
    const vercelRes = await fetch("https://api.vercel.com/v9/projects", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: slug,
        framework: "nextjs",
        installCommand: "npm install",
        buildCommand: "npm run build:web",
        outputDirectory: "apps/web/.next",
      }),
    });
    if (!vercelRes.ok) {
      const t = await vercelRes.text();
      throw new Error(`Vercel create project failed: ${vercelRes.status} ${t}`);
    }
    const vercelData = await vercelRes.json();
    vercelProjectUrl = vercelData.project?.projectId ? `https://${slug}.vercel.app` : null;
    console.log("Vercel project created:", vercelData.name || slug);
  } catch (e) {
    console.error("Vercel setup failed:", e.message);
    process.exit(1);
  }

  const clerkConfig = await setupClerkAutomatically(displayName, prompter, {
    vercelProjectUrl,
    slug,
  });

  // --- Replacements ---
  const replacements = [
    ["app-template", slug],
    ["App Template", displayName.trim()],
    ["app template", displayName.trim().toLowerCase()],
    ["apptemplate", compactName],
    ["com.apptemplate", bundlePrefix],
    ["@app-template/app", `@${slug}/app`],
    ["@app-template/ui", `@${slug}/ui`],
  ];

  const filesToReplace = [
    path.join(ROOT, "package.json"),
    path.join(ROOT, "packages/app/package.json"),
    path.join(ROOT, "packages/ui/package.json"),
    path.join(ROOT, "apps/web/package.json"),
    path.join(ROOT, "apps/mobile/package.json"),
    path.join(ROOT, "apps/web/next.config.mjs"),
    path.join(ROOT, "apps/mobile/app.json"),
    path.join(ROOT, "apps/web/app/layout.tsx"),
    path.join(ROOT, "apps/web/app/page.tsx"),
    path.join(ROOT, "apps/mobile/app/index.tsx"),
    path.join(ROOT, "README.md"),
    path.join(ROOT, "apps/web/lib/convex-client.ts"),
    path.join(ROOT, "apps/mobile/lib/convex.ts"),
  ];

  for (const filePath of filesToReplace) {
    try {
      let content = await fs.readFile(filePath, "utf8");
      for (const [from, to] of replacements) {
        content = content.split(from).join(to);
      }
      await fs.writeFile(filePath, content);
    } catch (e) {
      if (e.code === "ENOENT") {
        continue;
      }
      console.error("Failed to update", filePath, e.message);
    }
  }

  // app.json: set name (display), slug (slug-mobile), scheme (slug), bundleIdentifier, package, OAuth plugins
  const appJsonPath = path.join(ROOT, "apps/mobile/app.json");
  try {
    const appJson = JSON.parse(
      await fs.readFile(appJsonPath, "utf8")
    );
    const expo = appJson.expo || {};
    expo.name = `${displayName.trim()} Mobile`;
    expo.slug = `${slug}-mobile`;
    expo.scheme = slug;
    if (expo.ios) expo.ios.bundleIdentifier = `${bundlePrefix}.mobile`;
    if (expo.android) expo.android.package = `${bundlePrefix}.mobile`;
    appJson.expo = expo;
    await fs.writeFile(appJsonPath, JSON.stringify(appJson, null, 2));
  } catch (e) {
    console.error("Failed to update app.json:", e.message);
  }

  // --- Write env files ---
  const webEnvLines = [];
  const mobileEnvLines = [];
  if (convexUrl) {
    webEnvLines.push(`NEXT_PUBLIC_CONVEX_URL=${convexUrl}`);
    mobileEnvLines.push(`EXPO_PUBLIC_CONVEX_URL=${convexUrl}`);
  }
  if (clerkConfig) {
    webEnvLines.push(`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${clerkConfig.publishableKey}`);
    webEnvLines.push(`CLERK_SECRET_KEY=${clerkConfig.secretKey}`);
    mobileEnvLines.push(`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=${clerkConfig.publishableKey}`);
  }

  if (webEnvLines.length) {
    await fs.writeFile(path.join(ROOT, "apps/web/.env.local"), webEnvLines.join("\n") + "\n");
    console.log("Wrote apps/web/.env.local");
  }
  if (mobileEnvLines.length) {
    await fs.writeFile(path.join(ROOT, "apps/mobile/.env"), mobileEnvLines.join("\n") + "\n");
    console.log("Wrote apps/mobile/.env");
  }

  // --- Vercel env vars ---
  if (convexUrl) {
    await setVercelEnvVar(slug, vercelToken, "NEXT_PUBLIC_CONVEX_URL", convexUrl);
  }
  if (clerkConfig) {
    await setVercelEnvVar(
      slug,
      vercelToken,
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      clerkConfig.publishableKey
    );
    await setVercelEnvVar(slug, vercelToken, "CLERK_SECRET_KEY", clerkConfig.secretKey);
  }

  console.log("\nRunning npm install...");
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["install"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("npm install failed"))));
  });

  // --- Deploy to Convex ---
  if (deploymentName && convexUrl) {
    console.log("\nDeploying to Convex...");
    try {
      const keyRes = await fetch(
        `https://api.convex.dev/v1/deployments/${encodeURIComponent(deploymentName)}/create_deploy_key`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${convexToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: "init-script" }),
        }
      );
      if (!keyRes.ok) {
        const t = await keyRes.text();
        throw new Error(`Convex create_deploy_key failed: ${keyRes.status} ${t}`);
      }
      const keyData = await keyRes.json();
      const deployKey = keyData.deployKey;
      if (!deployKey) throw new Error("No deployKey in response");

      const convexDeployEnv = { ...process.env, CONVEX_DEPLOY_KEY: deployKey };

      await writeConvexDeploymentLink({ deploymentName, convexUrl });
      await prepareConvexAuthEnv(clerkConfig, {
        convexUrl,
        deployKey,
        convexDeployEnv,
      });

      await new Promise((resolve, reject) => {
        const child = spawn("npx", ["convex", "deploy"], {
          cwd: ROOT,
          stdio: "inherit",
          shell: true,
          env: convexDeployEnv,
        });
        child.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error("convex deploy failed"))
        );
      });
      console.log("Convex deploy done.");
    } catch (e) {
      console.error("Convex deploy failed:", e.message);
      console.error(
        "Recovery: set CLERK_JWT_ISSUER_DOMAIN in the Convex dashboard, then run npx convex deploy"
      );
    }
  }

  console.log("\nDeploying to Vercel...");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        "npx",
        ["vercel", "link", "--project", slug, "--yes"],
        {
          cwd: ROOT,
          stdio: "inherit",
          shell: true,
          env: { ...process.env, VERCEL_TOKEN: vercelToken },
        }
      );
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("vercel link failed"))
      );
    });
    await new Promise((resolve, reject) => {
      const child = spawn(
        "npx",
        ["vercel", "deploy", "--prod", "--yes"],
        {
          cwd: ROOT,
          stdio: "inherit",
          shell: true,
          env: { ...process.env, VERCEL_TOKEN: vercelToken },
        }
      );
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("vercel deploy failed"))
      );
    });
    console.log("Vercel deploy done.");
  } catch (e) {
    console.error("Vercel deploy failed:", e.message);
    console.warn(
      "Recovery: connect your own GitHub repo in Vercel settings (not the template repo), then run npm run deploy from the project root."
    );
  }

  console.log("\nDone. Next steps:");
  if (!clerkConfig) {
    console.log("  1. Run npm run init again or configure Clerk manually (see README)");
  } else {
    console.log("  1. Clerk, Convex, and Vercel are configured for local dev");
  }
  console.log("  2. Run: npm run dev:all");
  console.log("  3. Mobile: cd apps/mobile && npx expo run:ios (first time only)");
  console.log("  4. Sign up at /signup and verify /dashboard loads");
  } finally {
    prompter.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
