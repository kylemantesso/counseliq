"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import {
  parseCourseDefinition,
  parsePublishManifest,
  type UnitTiming,
} from "@counseliq/course-schema";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  buildPublishManifest,
  buildUnitDefinitionHash,
  computeSpecHash,
  publishPreconditionViolations,
  type PublishUnitRow,
} from "./publishCore";
import {
  createObjectStoreClient,
  getObjectText,
  headObjectExists,
  putObjectIfAbsent,
  type ObjectStoreClient,
} from "./objectStore";
import { ttsProviderName } from "./tts/models";

/**
 * PUBLISHING (M5): assemble the canonical Course Definition export and the
 * publish manifest, upload both (plus per-unit timing artifacts) to the
 * content-addressed object store, and freeze the course via finalizePublish.
 *
 * Mock-mode caveat: when TTS_PROVIDER=mock the synthesis stage records audio
 * keys without uploading bytes (see synthesize.ts), so audio existence
 * checks are skipped under the same condition — export, timing, and
 * manifest artifacts are still written and verified for real.
 */

const sha256 = (input: string): string =>
  createHash("sha256").update(input).digest("hex");

type PublishResult = {
  status: "ok" | "failed";
  cause?: string;
  exportKey?: string;
  manifestKey?: string;
  specHash?: string;
  version?: number;
  warnings?: string[];
};

function wireToDefinitionInput(wire: unknown): unknown {
  if (wire === null || typeof wire !== "object") return wire;
  const { schemaRef, ...rest } = wire as Record<string, unknown>;
  return { $schema: schemaRef, ...rest };
}

export const runPublish = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<PublishResult> => {
    const input = await ctx.runQuery(
      internal.pipeline.publishedCourses.getPublishInputInternal,
      { runId: args.runId }
    );
    if (input.run.state !== "PUBLISHING") {
      return {
        status: "failed",
        cause: `run is in state ${input.run.state} (expected PUBLISHING)`,
      };
    }

    const violations = publishPreconditionViolations(
      input.units as unknown as PublishUnitRow[]
    );
    if (violations.length > 0) {
      return {
        status: "failed",
        cause: `publish preconditions failed: ${violations.join("; ")}`,
      };
    }

    // Schema gate: an invalid definition never becomes an export artifact.
    let definition;
    try {
      definition = parseCourseDefinition(
        wireToDefinitionInput(input.definitionWire)
      );
    } catch (error) {
      return {
        status: "failed",
        cause: `export failed course-definition validation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const exportJson = JSON.stringify(definition);
    const specHash = computeSpecHash(exportJson, sha256);
    const exportKey = `sha256/${specHash}.json`;

    const definitionUnits = new Map(
      definition.modules.flatMap((module) =>
        module.microUnits.map((unit) => [unit.unitId, unit] as const)
      )
    );
    const manifestUnits = input.units.map((unit) => {
      const timing = unit.timing as UnitTiming;
      const timingJson = JSON.stringify(timing);
      return {
        unitId: unit.unitKey,
        moduleId: unit.moduleKey,
        unitDefinitionHash: buildUnitDefinitionHash(
          definitionUnits.get(unit.unitKey),
          sha256
        ),
        timing,
        timingKey: `sha256/${sha256(timingJson)}.json`,
        timingJson,
      };
    });

    const brandTokens =
      (input.institution.brandTokens as Record<string, unknown> | null) ?? null;
    const isPlaceholderTheme =
      brandTokens === null || brandTokens.placeholder === true;

    let manifest;
    let warnings: string[];
    try {
      const built = buildPublishManifest({
        definition,
        courseVersion: input.course.version,
        specHash,
        exportKey,
        runId: String(args.runId),
        institutionName: input.institution.name,
        themeSource: isPlaceholderTheme ? "placeholder" : "institution",
        themeTokens: brandTokens ?? {},
        promptVersions: input.run.promptVersions as Record<string, unknown>,
        publishedAtIso: new Date().toISOString(),
        units: manifestUnits,
      });
      manifest = built.manifest;
      warnings = built.warnings;
    } catch (error) {
      return {
        status: "failed",
        cause: `manifest assembly failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    const manifestJson = JSON.stringify(manifest);
    const manifestKey = `sha256/${sha256(manifestJson)}.json`;

    const audioKeys = new Set<string>();
    for (const unit of manifest.units) {
      for (const sentence of unit.audio.sentences) {
        audioKeys.add(sentence.audioKey);
      }
    }

    let store: ObjectStoreClient;
    try {
      store = createObjectStoreClient();
    } catch (error) {
      return {
        status: "failed",
        cause: `object store not configured: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    // Integrity first: every audio artifact the manifest references must
    // already exist (written by GENERATING_ASSETS) before anything uploads.
    if (ttsProviderName() !== "mock") {
      const missing: string[] = [];
      for (const key of audioKeys) {
        if (!(await headObjectExists(store, key))) missing.push(key);
      }
      if (missing.length > 0) {
        return {
          status: "failed",
          cause: `missing audio artifact(s) in object store: ${missing
            .slice(0, 5)
            .join(", ")}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ""}`,
        };
      }
    }

    try {
      await putObjectIfAbsent(store, exportKey, exportJson, "application/json");
      for (const unit of manifestUnits) {
        await putObjectIfAbsent(
          store,
          unit.timingKey,
          unit.timingJson,
          "application/json"
        );
      }
      await putObjectIfAbsent(store, manifestKey, manifestJson, "application/json");
    } catch (error) {
      return {
        status: "failed",
        cause: `artifact upload failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const finalized: { version: number } = await ctx.runMutation(
      internal.pipeline.publishedCourses.finalizePublish,
      {
        runId: args.runId,
        exportKey,
        manifestKey,
        specHash,
        counts: {
          modules: definition.modules.length,
          units: manifest.units.length,
          questions: definition.questionBank.length,
          audioArtifacts: audioKeys.size,
        },
        publishedBy: input.publishedBy,
      }
    );

    return {
      status: "ok",
      exportKey,
      manifestKey,
      specHash,
      version: finalized.version,
      warnings,
    };
  },
});

/**
 * Round-trip verification for walkthrough/eval: fetch the published manifest
 * from the store, re-parse it, and HEAD every artifact key it references.
 * (.mjs harnesses cannot sign S3 requests or import the Zod contracts, so
 * this runs server-side.)
 */
export const verifyPublishedArtifacts = internalAction({
  args: { runId: v.id("runs") },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; checked: number; missing: string[] }> => {
    const snapshot = await ctx.runQuery(
      internal.pipeline.publishedCourses.getPublishedCourseForRunInternal,
      { runId: args.runId }
    );
    if (!snapshot) {
      return { ok: false, checked: 0, missing: ["<no courseVersions row>"] };
    }

    const store = createObjectStoreClient();
    const manifest = parsePublishManifest(
      JSON.parse(await getObjectText(store, snapshot.manifestKey))
    );

    // Mock TTS runs never uploaded audio bytes; verify the artifacts publish
    // itself wrote (export + timing + manifest) and skip audio keys.
    const mockMode = ttsProviderName() === "mock";
    const audioKeys = new Set<string>();
    for (const unit of manifest.units) {
      for (const sentence of unit.audio.sentences) {
        audioKeys.add(sentence.audioKey);
      }
    }
    const keysToCheck = [
      ...manifest.artifactKeys.filter(
        (key) => !mockMode || !audioKeys.has(key)
      ),
      snapshot.manifestKey,
    ];

    const missing: string[] = [];
    for (const key of keysToCheck) {
      if (!(await headObjectExists(store, key))) missing.push(key);
    }
    return { ok: missing.length === 0, checked: keysToCheck.length, missing };
  },
});
