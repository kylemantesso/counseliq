/**
 * Minimal semver comparison for force-upgrade checks. We only care about the
 * numeric `major.minor.patch` core — any pre-release / build metadata suffix
 * (e.g. "-beta.1", "+exp.sha") is ignored, which is the right call for a
 * "is this build old enough to block?" decision. No dependency on the `semver`
 * package so this stays usable from the shared `@counseliq/client` layer on every
 * platform.
 */

function parseVersionCore(version: string): [number, number, number] {
  const core = version.trim().replace(/^v/i, "").split(/[-+]/)[0] ?? "";
  const parts = core.split(".");
  const major = Number.parseInt(parts[0] ?? "", 10);
  const minor = Number.parseInt(parts[1] ?? "", 10);
  const patch = Number.parseInt(parts[2] ?? "", 10);
  return [
    Number.isFinite(major) ? major : 0,
    Number.isFinite(minor) ? minor : 0,
    Number.isFinite(patch) ? patch : 0,
  ];
}

/**
 * Returns -1 if `a < b`, 1 if `a > b`, 0 if equal (ignoring pre-release tags).
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersionCore(a);
  const right = parseVersionCore(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

/** True when `current` is strictly older than `minimum`. */
export function isVersionBelow(current: string, minimum: string): boolean {
  return compareVersions(current, minimum) < 0;
}
