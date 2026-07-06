/**
 * Display version for the splash/landing chrome (web).
 *
 * Sourced from `NEXT_PUBLIC_APP_VERSION`, which `next.config.mjs` injects from
 * `apps/web/package.json` at build time so it stays in sync with the deploy.
 */
const rawVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

export const APP_VERSION = `V${rawVersion}`;

/**
 * Bare semver string of the running build ("1.0.3") — no "V" prefix. Mirrors
 * the native export so shared code can import it; force-upgrade is native-only,
 * so the web value is informational.
 */
export const APP_VERSION_NUMBER = rawVersion;
