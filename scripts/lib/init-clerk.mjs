import { spawn } from "child_process";

const PLAPI_BASE = "https://api.clerk.com";
const BAPI_BASE = "https://api.clerk.com/v1";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: opts.stdio ?? "pipe",
      shell: opts.shell !== false,
      env: opts.env ?? process.env,
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

async function clerkFetch(url, { token, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${url} failed (${response.status}): ${text}`);
  }
  return response.json();
}

function pickDevInstance(app) {
  return app.instances?.find((instance) => instance.environment_type === "development");
}

async function createClerkAppViaCli(name) {
  try {
    const { stdout } = await run(
      "npx",
      ["clerk@latest", "apps", "create", name, "--json"],
      { stdio: "pipe", shell: true }
    );
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function createClerkAppViaPlatformApi(name, platformApiKey) {
  const created = await clerkFetch(`${PLAPI_BASE}/v1/platform/applications`, {
    token: platformApiKey,
    method: "POST",
    body: { name },
  });

  const appId = created.application_id;
  if (!appId) {
    throw new Error("Clerk Platform API did not return application_id");
  }

  return clerkFetch(
    `${PLAPI_BASE}/v1/platform/applications/${encodeURIComponent(appId)}?include_secret_keys=true`,
    { token: platformApiKey }
  );
}

export async function getFrontendApiUrl(secretKey) {
  try {
    const domains = await clerkFetch(`${BAPI_BASE}/domains`, { token: secretKey });
    const list = Array.isArray(domains) ? domains : domains?.data ?? [];
    const primary = list.find((domain) => !domain.is_satellite) ?? list[0];
    if (primary?.frontend_api_url) {
      return primary.frontend_api_url.replace(/\/$/, "");
    }
  } catch {
    // fall through to manual prompt
  }
  return null;
}

async function ensureConvexJwtTemplate(secretKey, frontendApiUrl) {
  const listed = await clerkFetch(`${BAPI_BASE}/jwt_templates`, { token: secretKey });
  const templates = Array.isArray(listed) ? listed : listed?.data ?? [];
  if (templates.some((template) => template.name === "convex")) {
    return;
  }

  await clerkFetch(`${BAPI_BASE}/jwt_templates`, {
    token: secretKey,
    method: "POST",
    body: {
      name: "convex",
      claims: {
        aud: "convex",
        ...(frontendApiUrl ? { iss: frontendApiUrl } : {}),
      },
      lifetime: 3600,
    },
  });
}

async function addAllowedOrigins(secretKey, origins) {
  const uniqueOrigins = [...new Set(origins.filter(Boolean))];
  if (!uniqueOrigins.length) return;

  try {
    const instance = await clerkFetch(`${BAPI_BASE}/instance`, { token: secretKey });
    const current = instance.allowed_origins ?? [];
    const merged = [...new Set([...current, ...uniqueOrigins])];
    await clerkFetch(`${BAPI_BASE}/instance`, {
      token: secretKey,
      method: "PATCH",
      body: { allowed_origins: merged },
    });
  } catch (error) {
    console.warn("  Could not update Clerk allowed origins:", error.message);
  }
}

function extractClerkKeys(app) {
  const dev = pickDevInstance(app);
  if (!dev?.publishable_key || !dev?.secret_key) {
    throw new Error("Clerk development instance keys were not returned");
  }
  return {
    publishableKey: dev.publishable_key,
    secretKey: dev.secret_key,
    applicationId: app.application_id,
  };
}

export async function setupClerkAutomatically(displayName, prompter, options = {}) {
  const { vercelProjectUrl, slug } = options;

  console.log("\n--- Clerk setup ---\n");

  const mode = await prompter.promptChoice("How should Clerk be configured?", [
    {
      value: "auto",
      label: "Create a new Clerk application automatically (recommended)",
    },
    {
      value: "manual",
      label: "Paste keys from an existing Clerk application",
    },
    {
      value: "skip",
      label: "Skip Clerk for now",
    },
  ]);

  if (mode === "skip") {
    return null;
  }

  if (mode === "manual") {
    return setupClerkManually(prompter);
  }

  console.log("  Attempting Clerk CLI create (requires `npx clerk auth login` first)...");
  let app = await createClerkAppViaCli(displayName.trim());

  if (!app) {
    console.log("  Clerk CLI create unavailable or not authenticated.\n");
    const platformApiKey = await prompter.promptToken("Clerk Platform API key", {
      envVar: "CLERK_PLATFORM_API_KEY",
      helpText: [
        "Create one at https://dashboard.clerk.com/user/developers",
        "Or run: npx clerk auth login",
      ],
    });
    app = await createClerkAppViaPlatformApi(displayName.trim(), platformApiKey);
  }

  const keys = extractClerkKeys(app);
  let jwtIssuerDomain = await getFrontendApiUrl(keys.secretKey);

  if (!jwtIssuerDomain) {
    jwtIssuerDomain = await prompter.promptToken("Clerk Frontend API URL (JWT issuer)", {
      helpText: [
        "Find this in Clerk Dashboard → Configure → Convex integration",
        "Format: https://your-app.clerk.accounts.dev",
      ],
    });
  }

  console.log("  Ensuring Convex JWT template exists...");
  await ensureConvexJwtTemplate(keys.secretKey, jwtIssuerDomain);

  const localOrigin = "http://localhost:3000";
  const expoOrigin = "exp://localhost:8081";
  await addAllowedOrigins(keys.secretKey, [
    localOrigin,
    vercelProjectUrl,
    expoOrigin,
    slug ? `https://${slug}.vercel.app` : null,
  ]);

  console.log(`  Clerk app ready (${keys.applicationId}).`);
  console.log(`  Frontend API / JWT issuer: ${jwtIssuerDomain}`);

  return {
    publishableKey: keys.publishableKey,
    secretKey: keys.secretKey,
    jwtIssuerDomain,
    applicationId: keys.applicationId,
  };
}

async function setupClerkManually(prompter) {
  const publishableKey = await prompter.promptToken("Clerk publishable key (pk_test_...)", {
    envVar: "CLERK_PUBLISHABLE_KEY",
    helpText: ["Clerk Dashboard → API keys"],
  });
  const secretKey = await prompter.promptToken("Clerk secret key (sk_test_...)", {
    envVar: "CLERK_SECRET_KEY",
    helpText: ["Clerk Dashboard → API keys"],
  });
  let jwtIssuerDomain = await prompter.promptToken("Clerk Frontend API URL (JWT issuer)", {
    envVar: "CLERK_JWT_ISSUER_DOMAIN",
    helpText: [
      "Clerk Dashboard → Configure → Convex integration",
      "Format: https://your-app.clerk.accounts.dev",
    ],
  });

  if (!jwtIssuerDomain) {
    jwtIssuerDomain = await getFrontendApiUrl(secretKey);
  }

  if (jwtIssuerDomain) {
    try {
      await ensureConvexJwtTemplate(secretKey, jwtIssuerDomain);
    } catch (error) {
      console.warn("  Could not ensure Convex JWT template:", error.message);
      console.warn("  Activate the Convex integration in Clerk Dashboard if login fails.");
    }
  }

  return { publishableKey, secretKey, jwtIssuerDomain, applicationId: null };
}
