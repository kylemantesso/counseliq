import { z } from "zod";
import { voiceSchema } from "./course-definition";
import { assetAspectSchema, mediaAssetKindSchema } from "./assets";

/**
 * Publish manifest — the contract a gate-3 approval produces alongside the
 * Course Definition export. It is the single index Remotion (M6) and the
 * learner app use to fetch everything a published course version needs:
 * per-sentence audio artifacts, per-unit timing artifacts, theme tokens,
 * voice, and the versions that produced them.
 *
 * The manifest is stored content-addressed in the object store next to the
 * export it describes; `artifactKeys` is the deduped union of every object
 * key the manifest references and is the integrity-check surface (publish
 * verifies each key exists before finalizing).
 */

export const PUBLISH_MANIFEST_SCHEMA_REF = "counseliq://publish-manifest/v2";

export const manifestAssetSchema = z
  .object({
    /** Catalogue id captured at publish time (`assets._id` string). */
    assetRef: z.string().min(1),
    kind: mediaAssetKindSchema,
    /** Content-addressed bytes (image/video payload). */
    objectKey: z.string().min(1),
    /** Thumbnail for images; poster frame for videos. */
    thumbKey: z.string().min(1).optional(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspect: assetAspectSchema,
    /** Video only. */
    durationMs: z.number().int().positive().optional(),
  })
  .strict();

export const manifestAudioSentenceSchema = z
  .object({
    /** Narration sentence id ("n1", …) within the unit. */
    sentenceId: z.string().min(1),
    /** Per-sentence mp3, content-addressed: sha256/{hash}.mp3 */
    audioKey: z.string().min(1),
    /** Characters synthesised (billing/observability). */
    characters: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
  })
  .strict();

export const manifestUnitSchema = z
  .object({
    unitId: z.string().min(1),
    moduleId: z.string().min(1),
    /**
     * Hash of this unit's definition JSON at publish time. Manifest-local:
     * this is NOT microUnits.contentHash (the TTS invalidation hash) — it
     * fingerprints the published content, not the synthesis inputs.
     */
    contentHash: z.string().min(1),
    audio: z
      .object({
        sentences: z.array(manifestAudioSentenceSchema).min(1),
        /** Concatenated whole-unit audio, if produced (not in M5). */
        unitAudioKey: z.string().min(1).optional(),
      })
      .strict(),
    /** The unit's UnitTiming artifact: sha256/{hash}.json */
    timingKey: z.string().min(1),
    /** TIMING_VERSION of the referenced artifact. */
    timingSchemaVersion: z.number().int().positive(),
    /** Asset refs used by this unit's cards + anchor (deduped). */
    assetRefs: z.array(z.string().min(1)),
  })
  .strict();

const publishManifestObjectSchema = z
  .object({
    $schema: z.literal(PUBLISH_MANIFEST_SCHEMA_REF),
    /** CourseDefinition.courseId slug (not a Convex id). */
    courseId: z.string().min(1),
    /** courses.version at publish time. */
    courseVersion: z.number().int().positive(),
    /** sha256 hex of the export.json bytes. */
    specHash: z.string().min(1),
    /** Object key of the CourseDefinition export: sha256/{specHash}.json */
    exportKey: z.string().min(1),
    /** Pipeline run that produced this publish. */
    runId: z.string().min(1),
    institution: z
      .object({
        name: z.string().min(1),
        brandRef: z.string().min(1),
      })
      .strict(),
    theme: z
      .object({
        source: z.enum(["institution", "candidate", "placeholder"]),
        /** institutions.brandTokens snapshot at publish time. */
        tokens: z.record(z.string(), z.unknown()),
      })
      .strict(),
    /** The voice actually used for synthesis (from the timing artifacts). */
    voice: voiceSchema,
    language: z.string().min(1),
    versions: z
      .object({
        /** runs.promptVersions snapshot (prompt tags + routed models). */
        promptVersions: z.record(z.string(), z.unknown()),
        /** e.g. "counseliq://course-definition/v1" */
        courseSchemaRef: z.string().min(1),
      })
      .strict(),
    /** ISO-8601 timestamp. */
    publishedAt: z.string().min(1),
    units: z.array(manifestUnitSchema).min(1),
    /** Frozen catalogue snapshot keyed by assetRef for this version. */
    assets: z.record(z.string().min(1), manifestAssetSchema),
    /**
     * Deduped union of every object-store key this manifest references
     * (export + timing + audio). The publish integrity check HEADs each.
     */
    artifactKeys: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const publishManifestSchema = publishManifestObjectSchema.superRefine(
  (manifest, ctx) => {
    const keySet = new Set(manifest.artifactKeys);

    if (keySet.size !== manifest.artifactKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactKeys"],
        message: "artifactKeys contains duplicates — it must be a deduped set",
      });
    }

    if (!keySet.has(manifest.exportKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exportKey"],
        message: `exportKey "${manifest.exportKey}" is missing from artifactKeys`,
      });
    }

    const seenUnitIds = new Set<string>();
    manifest.units.forEach((unit, uIndex) => {
      if (seenUnitIds.has(unit.unitId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["units", uIndex, "unitId"],
          message: `duplicate unitId "${unit.unitId}"`,
        });
      }
      seenUnitIds.add(unit.unitId);

      if (!keySet.has(unit.timingKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["units", uIndex, "timingKey"],
          message: `timingKey "${unit.timingKey}" for unit "${unit.unitId}" is missing from artifactKeys`,
        });
      }

      if (
        unit.audio.unitAudioKey !== undefined &&
        !keySet.has(unit.audio.unitAudioKey)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["units", uIndex, "audio", "unitAudioKey"],
          message: `unitAudioKey "${unit.audio.unitAudioKey}" for unit "${unit.unitId}" is missing from artifactKeys`,
        });
      }

      unit.audio.sentences.forEach((sentence, sIndex) => {
        if (!keySet.has(sentence.audioKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["units", uIndex, "audio", "sentences", sIndex, "audioKey"],
            message: `audioKey "${sentence.audioKey}" for sentence "${sentence.sentenceId}" in unit "${unit.unitId}" is missing from artifactKeys`,
          });
        }
      });

      const seenRefs = new Set<string>();
      unit.assetRefs.forEach((assetRef, rIndex) => {
        if (seenRefs.has(assetRef)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["units", uIndex, "assetRefs", rIndex],
            message: `duplicate assetRef "${assetRef}" in unit "${unit.unitId}"`,
          });
          return;
        }
        seenRefs.add(assetRef);

        const asset = manifest.assets[assetRef];
        if (!asset) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["units", uIndex, "assetRefs", rIndex],
            message: `assetRef "${assetRef}" in unit "${unit.unitId}" is missing from assets`,
          });
          return;
        }

        if (!keySet.has(asset.objectKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["assets", assetRef, "objectKey"],
            message: `objectKey "${asset.objectKey}" for assetRef "${assetRef}" is missing from artifactKeys`,
          });
        }
        if (asset.thumbKey !== undefined && !keySet.has(asset.thumbKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["assets", assetRef, "thumbKey"],
            message: `thumbKey "${asset.thumbKey}" for assetRef "${assetRef}" is missing from artifactKeys`,
          });
        }
      });
    });

    for (const [assetRef, asset] of Object.entries(manifest.assets)) {
      if (asset.assetRef !== assetRef) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", assetRef, "assetRef"],
          message: `asset map key "${assetRef}" must match assetRef "${asset.assetRef}"`,
        });
      }

      if (!keySet.has(asset.objectKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", assetRef, "objectKey"],
          message: `objectKey "${asset.objectKey}" for assetRef "${assetRef}" is missing from artifactKeys`,
        });
      }
      if (asset.thumbKey !== undefined && !keySet.has(asset.thumbKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", assetRef, "thumbKey"],
          message: `thumbKey "${asset.thumbKey}" for assetRef "${assetRef}" is missing from artifactKeys`,
        });
      }

      if (asset.kind === "video" && asset.durationMs === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", assetRef, "durationMs"],
          message: `video assetRef "${assetRef}" is missing durationMs`,
        });
      }
    }
  }
);

export type ManifestAsset = z.infer<typeof manifestAssetSchema>;
export type ManifestAudioSentence = z.infer<typeof manifestAudioSentenceSchema>;
export type ManifestUnit = z.infer<typeof manifestUnitSchema>;
export type PublishManifest = z.infer<typeof publishManifestSchema>;

export class PublishManifestParseError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    const details = issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    super(`Invalid publish manifest (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n${details}`);
    this.name = "PublishManifestParseError";
    this.issues = issues;
  }
}

/** Parse an untrusted value into a PublishManifest, throwing a readable error on failure. */
export function parsePublishManifest(input: unknown): PublishManifest {
  const result = publishManifestSchema.safeParse(input);
  if (!result.success) {
    throw new PublishManifestParseError(result.error.issues);
  }
  return result.data;
}
