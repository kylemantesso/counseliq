import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { bundle } from "@remotion/bundler";
import { getCompositions, renderMedia } from "@remotion/renderer";
import {
  contentEndMsForTiming,
  parseCourseDefinition,
  parsePublishManifest,
  renderFailurePayloadSchema,
  renderAvatarTrackSchema,
  renderSuccessPayloadSchema,
  unitTimingSchema,
  type RenderJobRequest,
  type RenderAvatarTrack,
  type RenderOutputVariant,
  type RenderProfile,
  type RenderVariantProfile,
} from "@counseliq/course-schema";
import type { RendererConfig } from "./config";
import { ObjectStore } from "./store";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REMOTION_ENTRY = join(__dirname, "remotion", "index.ts");
const COMPOSITION_ID = "unit-content-video";

let bundlePromise: Promise<string> | null = null;

async function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({ entryPoint: REMOTION_ENTRY });
  }
  return await bundlePromise;
}

function readHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accept the optional render metadata without weakening the canonical,
 * strict publish-manifest parser. The metadata is stripped before parsing
 * because older manifest versions intentionally do not declare it.
 */
function withoutAvatarTracks(manifest: unknown): unknown {
  if (!isRecord(manifest) || !Array.isArray(manifest.units)) return manifest;
  return {
    ...manifest,
    units: manifest.units.map((unit) => {
      if (!isRecord(unit) || !("avatarTrack" in unit)) return unit;
      const { avatarTrack: _avatarTrack, ...unitWithoutAvatarTrack } = unit;
      return unitWithoutAvatarTrack;
    }),
  };
}

export function readAvatarTrackFromFrozenManifest(
  manifest: unknown,
  unitId: string
): RenderAvatarTrack | undefined {
  if (!isRecord(manifest) || !Array.isArray(manifest.units)) return undefined;

  let matchedTrack: RenderAvatarTrack | undefined;
  for (const unit of manifest.units) {
    if (!isRecord(unit) || !("avatarTrack" in unit)) continue;
    const parsed = renderAvatarTrackSchema.safeParse(unit.avatarTrack);
    if (!parsed.success) {
      throw new Error("invalid units[].avatarTrack in frozen manifest");
    }
    if (unit.unitId === unitId) matchedTrack = parsed.data;
  }
  return matchedTrack;
}

function variantProfiles(job: RenderJobRequest): RenderVariantProfile[] {
  if (job.variants && job.variants.length > 0) return job.variants;
  return [
    {
      label: `${job.profile.width}x${job.profile.height}`,
      ...job.profile,
    },
  ];
}

function safeFileLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "variant";
}

function stripVariantLabel(variant: RenderVariantProfile): RenderProfile {
  return {
    container: variant.container,
    width: variant.width,
    height: variant.height,
    fps: variant.fps,
    videoCodec: variant.videoCodec,
    audioCodec: variant.audioCodec,
  };
}

export async function runRenderJob(
  job: RenderJobRequest,
  store: ObjectStore,
  config: RendererConfig
) {
  const frozenManifest = JSON.parse(await store.downloadText(job.manifestKey));
  const manifestAvatarTrack = readAvatarTrackFromFrozenManifest(
    frozenManifest,
    job.unitId
  );
  const manifest = parsePublishManifest(withoutAvatarTracks(frozenManifest));
  if (
    manifestAvatarTrack &&
    !manifest.artifactKeys.includes(manifestAvatarTrack.objectKey)
  ) {
    throw new Error(
      `avatar track ${manifestAvatarTrack.objectKey} for unit ${job.unitId} is missing from artifactKeys`
    );
  }
  const unitManifest = manifest.units.find((unit) => unit.unitId === job.unitId);
  if (!unitManifest) {
    throw new Error(`unit ${job.unitId} missing from manifest`);
  }

  const definition = parseCourseDefinition(
    JSON.parse(await store.downloadText(job.exportKey))
  );
  const module = definition.modules.find((m) => m.moduleId === job.moduleId);
  const unit = module?.microUnits.find((u) => u.unitId === job.unitId);
  if (!unit) {
    throw new Error(`unit ${job.unitId} missing from export definition`);
  }

  const timing = unitTimingSchema.parse(
    JSON.parse(await store.downloadText(unitManifest.timingKey))
  );

  const assetUrls: Record<string, string> = {};
  for (const ref of unitManifest.assetRefs) {
    const asset = manifest.assets[ref];
    if (!asset) {
      throw new Error(`assetRef ${ref} missing from manifest.assets`);
    }
    assetUrls[ref] = await store.presignGet(
      asset.objectKey,
      config.signedUrlTtlSeconds
    );
    const posterKey = asset.thumbKey ?? asset.objectKey;
    assetUrls[`poster:${ref}`] = await store.presignGet(
      posterKey,
      config.signedUrlTtlSeconds
    );
  }

  const unitAudioUrl = await store.presignGet(
    unitManifest.audio.unitAudioKey,
    config.signedUrlTtlSeconds
  );

  const avatarTrack = manifestAvatarTrack ?? job.avatarTrack;
  const avatarVideoUrl = avatarTrack
    ? await store.presignGet(avatarTrack.objectKey, config.signedUrlTtlSeconds)
    : undefined;

  const themeTokens: Record<string, unknown> = {
    ...(manifest.theme.tokens as Record<string, unknown>),
    brandRef: manifest.institution.brandRef,
  };
  const institutionLogoUrl = readHttpUrl(themeTokens.logoUrl);
  const inputProps = {
    unit,
    timing,
    profile: job.profile,
    themeTokens,
    assetUrls,
    unitAudioUrl,
    avatarVideoUrl,
    institutionLogoUrl,
  };

  const serveUrl = await getBundle();
  const workDir = await mkdtemp(join(tmpdir(), "renderer-job-"));
  try {
    const outputs: RenderOutputVariant[] = [];
    const durationMs = contentEndMsForTiming(timing);

    for (const variant of variantProfiles(job)) {
      const profile = stripVariantLabel(variant);
      const variantInputProps = { ...inputProps, profile };
      const compositions = await getCompositions(serveUrl, {
        inputProps: variantInputProps,
        logLevel: "error",
      });
      const composition = compositions.find((c) => c.id === COMPOSITION_ID);
      if (!composition) {
        throw new Error(`Composition ${COMPOSITION_ID} not found`);
      }

      const outputPath = join(
        workDir,
        `${job.jobId}-${safeFileLabel(variant.label)}.mp4`
      );
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        audioCodec: "aac",
        outputLocation: outputPath,
        inputProps: variantInputProps,
        chromiumOptions: { disableWebSecurity: true },
        logLevel: "error",
        pixelFormat: "yuv420p",
      });

      const bytes = await readFile(outputPath);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const objectKey = `sha256/${sha256}.mp4`;
      await store.uploadIfAbsent(objectKey, bytes, "video/mp4");
      outputs.push({
        label: variant.label,
        objectKey,
        sha256,
        sizeBytes: bytes.byteLength,
        durationMs,
        width: profile.width,
        height: profile.height,
        fps: profile.fps,
      });
    }

    const primary =
      outputs.find(
        (output) =>
          output.width === job.profile.width &&
          output.height === job.profile.height &&
          output.fps === job.profile.fps
      ) ?? outputs[0];

    return renderSuccessPayloadSchema.parse({
      objectKey: primary.objectKey,
      sha256: primary.sha256,
      sizeBytes: primary.sizeBytes,
      durationMs: primary.durationMs,
      width: primary.width,
      height: primary.height,
      fps: primary.fps,
      rendererVersion: config.rendererVersion,
      renderedAt: Date.now(),
      variants: outputs,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export function renderFailure(error: unknown, retryable = true) {
  const message = error instanceof Error ? error.message : String(error);
  return renderFailurePayloadSchema.parse({
    code: "render_failed",
    message,
    retryable,
  });
}
