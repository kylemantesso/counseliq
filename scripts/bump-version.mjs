#!/usr/bin/env node
/**
 * Bump semver in root + workspace package.json files, package-lock, and Expo app.json.
 * Usage: node scripts/bump-version.mjs <patch|minor|major>
 * Prints the new version to stdout.
 */
import fs from "node:fs";
import path from "node:path";

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  console.error("Usage: node scripts/bump-version.mjs <patch|minor|major>");
  process.exit(1);
}

const rootDir = process.cwd();
const rootPkgPath = path.join(rootDir, "package.json");
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
const parts = rootPkg.version.split(".").map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  console.error(`Invalid version in package.json: ${rootPkg.version}`);
  process.exit(1);
}

const [major, minor, patchNum] = parts;
const next =
  bump === "major"
    ? `${major + 1}.0.0`
    : bump === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patchNum + 1}`;

const packageJsonPaths = [
  "package.json",
  "apps/admin-web/package.json",
  "apps/client-web/package.json",
  "apps/client-mobile/package.json",
  "packages/admin/package.json",
  "packages/client/package.json",
  "packages/ui/package.json",
];

for (const rel of packageJsonPaths) {
  const filePath = path.join(rootDir, rel);
  const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));
  pkg.version = next;
  fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

const lockPath = path.join(rootDir, "package-lock.json");
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
lock.version = next;
const lockWorkspaceKeys = [
  "",
  "apps/admin-web",
  "apps/client-web",
  "apps/client-mobile",
  "packages/admin",
  "packages/client",
  "packages/ui",
];
for (const key of lockWorkspaceKeys) {
  if (lock.packages?.[key]) {
    lock.packages[key].version = next;
  }
}
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

const appJsonPath = path.join(rootDir, "apps/client-mobile/app.json");
const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
if (appJson.expo) {
  appJson.expo.version = next;
}
fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);

console.log(next);
