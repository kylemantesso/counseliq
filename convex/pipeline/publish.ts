"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import {
  parseCourseDefinition,
  parsePublishManifest,
  type UnitTiming,
} from "@counseliq/course-schema";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
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
import { DEFAULT_RENDER_PROFILE, DEFAULT_RENDER_VARIANTS } from "./render";

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

const RENDERER_SPEC_VERSION = "renderer@4-responsive";

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

function collectAssetRefsFromUnit(unit: unknown): string[] {
  if (unit === null || typeof unit !== "object") return [];
  const refs = new Set<string>();
  const unitRecord = unit as {
    cards?: unknown;
    meta?: { anchor?: { props?: unknown } };
  };

  const collectFromProps = (props: unknown) => {
    if (!props || typeof props !== "object") return;
    const record = props as { assetRef?: unknown; bgAssetRef?: unknown };
    if (typeof record.assetRef === "string" && record.assetRef.length > 0) {
      refs.add(record.assetRef);
    }
    if (
      typeof record.bgAssetRef === "string" &&
      record.bgAssetRef.length > 0
    ) {
      refs.add(record.bgAssetRef);
    }
  };

  if (Array.isArray(unitRecord.cards)) {
    for (const card of unitRecord.cards) {
      collectFromProps((card as { props?: unknown }).props);
    }
  }
  collectFromProps(unitRecord.meta?.anchor?.props);
  return [...refs];
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
    if (Array.isArray(input.assetIssues) && input.assetIssues.length > 0) {
      return {
        status: "failed",
        cause: `publish media snapshot failed: ${input.assetIssues.join("; ")}`,
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
    const publishUnits = input.units as Array<
      PublishUnitRow & {
        unitKey: string;
        moduleKey: string;
        timing: unknown;
        audioKey?: string;
        _id: Id<"microUnits">;
      }
    >;
    const manifestUnits = publishUnits.map((unit) => {
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
        unitAudioKey: timing.unitAudioKey,
        timingKey: `sha256/${sha256(timingJson)}.json`,
        timingJson,
        assetRefs: collectAssetRefsFromUnit(unit),
        ...(input.avatarTracksByUnit?.[String(unit._id)] !== undefined
          ? { avatarTrack: input.avatarTracksByUnit[String(unit._id)] }
          : {}),
      };
    });

    const frozenAssets = (input.assetsByRef ?? {}) as Record<
      string,
      {
        assetRef: string;
        kind: "image" | "video";
        objectKey: string;
        thumbKey?: string;
        width: number;
        height: number;
        aspect: "portrait" | "landscape" | "square";
        durationMs?: number;
      }
    >;

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
        assets: frozenAssets,
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

    const audioKeys = new Set(manifest.units.map((unit) => unit.audio.unitAudioKey));
    const mediaKeys = new Set<string>();
    for (const asset of Object.values(manifest.assets)) {
      mediaKeys.add(asset.objectKey);
      if (asset.thumbKey !== undefined) {
        mediaKeys.add(asset.thumbKey);
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

    if (mediaKeys.size > 0) {
      const missing: string[] = [];
      for (const key of mediaKeys) {
        if (!(await headObjectExists(store, key))) missing.push(key);
      }
      if (missing.length > 0) {
        return {
          status: "failed",
          cause: `missing media artifact(s) in object store: ${missing
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

    const finalized: { courseVersionId: Id<"courseVersions">; version: number } =
      await ctx.runMutation(
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

    try {
      const profile = DEFAULT_RENDER_PROFILE;
      await ctx.runMutation(internal.pipeline.render.enqueueRenderJobs, {
        runId: args.runId,
        courseVersionId: finalized.courseVersionId,
        manifestKey,
        exportKey,
        specHash,
        profile,
        units: manifest.units.map((unit, unitIndex) => ({
          unitId: unit.unitId,
          moduleId: unit.moduleId,
          unitIndex,
          contentHash: unit.contentHash,
          renderSpecHash: sha256(
            JSON.stringify({
              manifestKey,
              specHash,
              unitId: unit.unitId,
              contentHash: unit.contentHash,
              profile,
              variants: DEFAULT_RENDER_VARIANTS,
              rendererVersion: RENDERER_SPEC_VERSION,
              avatarTrack: unit.avatarTrack ?? null,
            })
          ),
        })),
      });

      const dispatch = await ctx.runAction(
        internal.pipeline.render.dispatchQueuedForRun,
        { runId: args.runId }
      );
      if (dispatch.failed > 0) {
        warnings.push(
          `render dispatch: ${dispatch.dispatched} accepted, ${dispatch.failed} failed`
        );
      }
    } catch (error) {
      warnings.push(
        `render enqueue failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

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
    const audioKeys = new Set(manifest.units.map((unit) => unit.audio.unitAudioKey));
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
