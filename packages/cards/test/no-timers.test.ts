import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, test } from "vitest";

/**
 * Mechanical enforcement of the no-timer contract: card source must be a
 * pure function of (props, timing, theme). Any clock, timer, randomness,
 * state hook, or CSS animation in src/ breaks determinism under Remotion
 * frame capture and fails here.
 *
 * card-stage.tsx is whitelisted for LAYOUT hooks only (it measures its
 * container); card-video.tsx for imperative <video> control driven purely
 * by host-clock props — timers and CSS animations stay banned in both.
 */

const SRC_DIR = join(__dirname, "..", "src");

/** Banned everywhere in src/. */
const BANNED_ALWAYS =
  /\b(setTimeout|setInterval|requestAnimationFrame|setImmediate|Date\.now|performance\.now|Math\.random)\b|new Audio|[^a-zA-Z-](transition|animation)\s*:/;

/** Additionally banned outside the layout-measurement whitelist. */
const BANNED_HOOKS = /\b(useEffect|useLayoutEffect|useRef)\b/;

const HOOK_WHITELIST = new Set(["card-stage.tsx", "card-video.tsx"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("no-timer contract", () => {
  const files = walk(SRC_DIR);

  test("finds card source files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of walk(SRC_DIR)) {
    const rel = relative(SRC_DIR, file);
    test(`src/${rel} is clock-free`, () => {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      const violations: string[] = [];
      lines.forEach((line, i) => {
        if (BANNED_ALWAYS.test(line)) {
          violations.push(`${rel}:${i + 1} banned pattern: ${line.trim()}`);
        }
        if (!HOOK_WHITELIST.has(rel) && BANNED_HOOKS.test(line)) {
          violations.push(`${rel}:${i + 1} banned hook: ${line.trim()}`);
        }
      });
      expect(violations).toEqual([]);
    });
  }
});
