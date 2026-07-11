import Constants from "expo-constants";

/**
 * Display version for the splash/landing chrome.
 *
 * Native: sourced from `expo.version` in `app.json` via expo-constants, so it
 * always matches the binary shipped to TestFlight / Play. The web counterpart
 * lives in `app-version.web.ts` and reads the value injected by Next.
 */
const rawVersion = Constants.expoConfig?.version ?? "0.0.0";

export const APP_VERSION = `V${rawVersion}`;

/**
 * Bare semver string of the running build ("1.0.3") — no "V" prefix. Used by
 * the force-upgrade gate to compare against the minimum version from Convex.
 */
export const APP_VERSION_NUMBER = rawVersion;
