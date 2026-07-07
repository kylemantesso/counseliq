import type { PublishManifest, UnitTiming } from "@counseliq/course-schema";
import {
  PUBLISH_MANIFEST_SCHEMA_REF,
  TIMING_VERSION,
  publishManifestSchema,
} from "@counseliq/course-schema";

/**
 * Pure publish logic: precondition checks, hashes, and manifest assembly.
 * No Convex, no node built-ins — the sha256 implementation is injected so
 * this module tests without the "use node" runtime (mirrors assemble.ts /
 * judgeCore.ts). Orchestration lives in publish.ts.
 */

export type Sha256Fn = (input: string) => string;

/** sha256 hex of the export.json bytes — the course version fingerprint. */
export function computeSpecHash(exportJson: string, sha256: Sha256Fn): string {
  return sha256(exportJson);
}

/**
 * Hash of one unit's definition slice for the publish manifest. This is
 * deliberately NOT microUnits.contentHash: that field is the TTS
 * invalidation hash (synthesis inputs — spoken text, voice, model) and is
 * owned by the assets stage. This one fingerprints the published content.
 */
export function buildUnitDefinitionHash(
  unitDefinition: unknown,
  sha256: Sha256Fn
): string {
  return sha256(JSON.stringify(unitDefinition));
}

export interface PublishUnitRow {
  unitKey: string;
  state: string;
  error?: { retryable: boolean; cause: string };
  timing?: unknown;
  narration: Array<{ id: string; text: string }>;
}

/**
 * The last line of defense before money-shaped side effects: every unit
 * must be assets_ready with a current-version timing artifact covering
 * every narration sentence. Gate-3 blocking should have caught all of
 * these already; publish refuses rather than trusts.
 */
export function publishPreconditionViolations(units: PublishUnitRow[]): string[] {
  const violations: string[] = [];

  for (const unit of units) {
    if (unit.state !== "assets_ready") {
      violations.push(
        `unit ${unit.unitKey}: state is "${unit.state}" (expected "assets_ready")`
      );
      continue;
    }

    if (unit.error !== undefined) {
      violations.push(`unit ${unit.unitKey}: has an unresolved error (${unit.error.cause})`);
    }

    if (unit.timing === undefined || unit.timing === null) {
      violations.push(`unit ${unit.unitKey}: missing timing artifact`);
      continue;
    }

    const timing = unit.timing as Partial<UnitTiming>;
    if (timing.version !== TIMING_VERSION) {
      violations.push(
        `unit ${unit.unitKey}: timing artifact version ${String(timing.version)} (expected ${TIMING_VERSION})`
      );
      continue;
    }

    const timedSentences = new Map(
      (timing.sentences ?? []).map((sentence) => [sentence.narrationId, sentence])
    );
    for (const sentence of unit.narration) {
      const timed = timedSentences.get(sentence.id);
      if (timed === undefined) {
        violations.push(
          `unit ${unit.unitKey}: narration sentence "${sentence.id}" has no timing entry`
        );
      } else if (!timed.audioKey) {
        violations.push(
          `unit ${unit.unitKey}: narration sentence "${sentence.id}" has no audio artifact`
        );
      }
    }
  }

  return violations;
}

export interface ManifestUnitInput {
  unitId: string;
  moduleId: string;
  unitDefinitionHash: string;
  timing: UnitTiming;
  timingKey: string;
}

export interface BuildPublishManifestInput {
  definition: {
    courseId: string;
    brandRef: string;
    language: string;
    voice: { provider: string; voiceRef: string; pronunciationLexicon: Record<string, string> };
  };
  courseVersion: number;
  specHash: string;
  exportKey: string;
  runId: string;
  institutionName: string;
  themeSource: "institution" | "candidate" | "placeholder";
  themeTokens: Record<string, unknown>;
  promptVersions: Record<string, unknown>;
  publishedAtIso: string;
  units: ManifestUnitInput[];
}

export interface BuildPublishManifestResult {
  manifest: PublishManifest;
  /** Non-fatal divergences, e.g. definition voice vs synthesis voice. */
  warnings: string[];
}

/**
 * Assemble and self-validate the publish manifest. The manifest's voice is
 * the voice the audio was ACTUALLY synthesised with (from the timing
 * artifacts); a divergence from the definition's declared voice is
 * reported as a warning, not an error.
 */
export function buildPublishManifest(
  input: BuildPublishManifestInput
): BuildPublishManifestResult {
  if (input.units.length === 0) {
    throw new Error("buildPublishManifest: no units supplied");
  }

  const warnings: string[] = [];
  const synthesis = input.units[0].timing;

  if (synthesis.voiceRef !== input.definition.voice.voiceRef) {
    warnings.push(
      `voice mismatch: definition declares voiceRef "${input.definition.voice.voiceRef}" but audio was synthesised with "${synthesis.voiceRef}"`
    );
  }
  if (synthesis.provider !== input.definition.voice.provider) {
    warnings.push(
      `voice mismatch: definition declares provider "${input.definition.voice.provider}" but audio was synthesised with "${synthesis.provider}"`
    );
  }

  const artifactKeys = new Set<string>([input.exportKey]);
  for (const unit of input.units) {
    artifactKeys.add(unit.timingKey);
    for (const sentence of unit.timing.sentences) {
      artifactKeys.add(sentence.audioKey);
    }
  }

  const manifest = publishManifestSchema.parse({
    $schema: PUBLISH_MANIFEST_SCHEMA_REF,
    courseId: input.definition.courseId,
    courseVersion: input.courseVersion,
    specHash: input.specHash,
    exportKey: input.exportKey,
    runId: input.runId,
    institution: {
      name: input.institutionName,
      brandRef: input.definition.brandRef,
    },
    theme: {
      source: input.themeSource,
      tokens: input.themeTokens,
    },
    voice: {
      provider: synthesis.provider,
      voiceRef: synthesis.voiceRef,
      pronunciationLexicon: input.definition.voice.pronunciationLexicon,
    },
    language: input.definition.language,
    versions: {
      promptVersions: input.promptVersions,
      courseSchemaRef: "counseliq://course-definition/v1",
    },
    publishedAt: input.publishedAtIso,
    units: input.units.map((unit) => ({
      unitId: unit.unitId,
      moduleId: unit.moduleId,
      contentHash: unit.unitDefinitionHash,
      audio: {
        sentences: unit.timing.sentences.map((sentence) => ({
          sentenceId: sentence.narrationId,
          audioKey: sentence.audioKey,
          characters: sentence.speakText.length,
          durationMs: sentence.durationMs,
        })),
      },
      timingKey: unit.timingKey,
      timingSchemaVersion: unit.timing.version,
    })),
    artifactKeys: [...artifactKeys],
  });

  return { manifest, warnings };
}

/** Every object-store key a manifest references (already deduped). */
export function collectArtifactKeys(manifest: PublishManifest): string[] {
  return [...manifest.artifactKeys];
}
