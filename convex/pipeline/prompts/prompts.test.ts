// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs script, no type declarations.
import { buildPromptsModule } from "../../../scripts/build-prompts.mjs";
import { ALL_PROMPTS, PROMPTS } from "./index";

const PROMPTS_DIR = dirname(fileURLToPath(import.meta.url));

describe("prompt codegen", () => {
  test("generated index.ts matches the .md sources (run npm run prompts:build)", () => {
    const expected = buildPromptsModule(PROMPTS_DIR) as string;
    const actual = readFileSync(join(PROMPTS_DIR, "index.ts"), "utf8");
    expect(actual).toBe(expected);
  });

  test("all three M3 tasks have a latest prompt", () => {
    expect(PROMPTS["extract-page"].versionTag).toMatch(/^extract-page@\d+$/);
    expect(PROMPTS["merge-inventory"].versionTag).toMatch(
      /^merge-inventory@\d+$/
    );
    expect(PROMPTS["infer-theme"].versionTag).toMatch(/^infer-theme@\d+$/);
  });

  test("version tags are unique across all prompt versions", () => {
    const tags = ALL_PROMPTS.map((p) => p.versionTag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});
