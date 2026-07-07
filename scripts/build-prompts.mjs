#!/usr/bin/env node
/**
 * Generates convex/pipeline/prompts/index.ts from the versioned prompt
 * markdown files (<id>@<version>.md) in the same directory. Convex's bundler
 * cannot import .md files, so the generated module is checked in; a unit
 * test asserts it matches the sources so drift fails CI.
 *
 * Usage: node scripts/build-prompts.mjs        (regenerate)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "convex",
  "pipeline",
  "prompts"
);

const FILENAME_PATTERN = /^([a-z0-9-]+)@(\d+)\.md$/;

function parseHeader(raw, filename) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${filename}: missing --- header block`);
  const fields = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  for (const required of ["id", "version", "requires", "output-schema"]) {
    if (!fields[required]) {
      throw new Error(`${filename}: header missing "${required}"`);
    }
  }
  return fields;
}

/** Builds the generated module source from the prompt .md files. */
export function buildPromptsModule(dir = PROMPTS_DIR) {
  const files = readdirSync(dir)
    .filter((f) => FILENAME_PATTERN.test(f))
    .sort();
  if (files.length === 0) throw new Error(`no prompt files found in ${dir}`);

  const prompts = files.map((filename) => {
    const [, id, versionStr] = filename.match(FILENAME_PATTERN);
    const raw = readFileSync(join(dir, filename), "utf8");
    const header = parseHeader(raw, filename);
    const version = Number(versionStr);
    if (header.id !== id || Number(header.version) !== version) {
      throw new Error(
        `${filename}: header id/version (${header.id}@${header.version}) does not match filename`
      );
    }
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    return {
      id,
      version,
      requires: header.requires,
      outputSchemaRef: header["output-schema"],
      content: body,
    };
  });

  // Latest version per id.
  const latest = new Map();
  for (const prompt of prompts) {
    const existing = latest.get(prompt.id);
    if (!existing || prompt.version > existing.version) {
      latest.set(prompt.id, prompt);
    }
  }

  const lines = [];
  lines.push("// GENERATED FILE — do not edit by hand.");
  lines.push("// Source of truth: convex/pipeline/prompts/*.md");
  lines.push("// Regenerate with: npm run prompts:build");
  lines.push("");
  lines.push("export interface PromptDefinition {");
  lines.push("  id: string;");
  lines.push("  version: number;");
  lines.push('  /** "versionTag" = `${id}@${version}`, recorded on runs/llmCalls. */');
  lines.push("  versionTag: string;");
  lines.push("  requires: string;");
  lines.push("  outputSchemaRef: string;");
  lines.push("  content: string;");
  lines.push("}");
  lines.push("");
  lines.push("export const ALL_PROMPTS: PromptDefinition[] = [");
  for (const p of prompts) {
    lines.push("  {");
    lines.push(`    id: ${JSON.stringify(p.id)},`);
    lines.push(`    version: ${p.version},`);
    lines.push(`    versionTag: ${JSON.stringify(`${p.id}@${p.version}`)},`);
    lines.push(`    requires: ${JSON.stringify(p.requires)},`);
    lines.push(`    outputSchemaRef: ${JSON.stringify(p.outputSchemaRef)},`);
    lines.push(`    content: ${JSON.stringify(p.content)},`);
    lines.push("  },");
  }
  lines.push("];");
  lines.push("");
  const ids = [...latest.keys()].sort();
  lines.push(
    `export type PromptId = ${ids.map((id) => JSON.stringify(id)).join(" | ")};`
  );
  lines.push("");
  lines.push("/** Latest version of each prompt, keyed by id. */");
  lines.push("export const PROMPTS: Record<PromptId, PromptDefinition> = {");
  for (const id of ids) {
    const p = latest.get(id);
    lines.push(
      `  ${JSON.stringify(id)}: ALL_PROMPTS[${prompts.indexOf(p)}],`
    );
  }
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const source = buildPromptsModule();
  const outPath = join(PROMPTS_DIR, "index.ts");
  writeFileSync(outPath, source);
  console.log(`wrote ${outPath}`);
}
