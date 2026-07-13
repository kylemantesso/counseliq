import { v } from "convex/values";
import { action, internalQuery, mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireAdmin } from "../../admin";
import { AppErrorCode, appError } from "../../errors";
import { createElevenLabsProvider } from "./elevenlabs";
import { ttsModel } from "./models";

const ELEVENLABS_VOICES_URL = "https://api.elevenlabs.io/v1/voices";
const MAX_AUDITION_TEXT_CHARS = 360;
const VOICE_EDIT_RUN_STATES = new Set(["GATE_2_COURSE_REVIEW", "GATE_3_PREVIEW"]);

type VoiceSettings = {
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speakerBoost?: boolean;
  speed?: number;
};
const accentValidator = v.union(
  v.literal("all"),
  v.literal("australian"),
  v.literal("american"),
  v.literal("english")
);
type EnglishAccent = "all" | "australian" | "american" | "english";

function clampSetting(value: number | undefined, min: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function normalizeSettings(settings: VoiceSettings | undefined): VoiceSettings {
  const stability = clampSetting(settings?.stability ?? 0.55, 0, 1);
  const similarityBoost = clampSetting(settings?.similarityBoost ?? 0.85, 0, 1);
  const style = clampSetting(settings?.style, 0, 1);
  const speed = clampSetting(settings?.speed, 0.7, 1.2);
  return {
    ...(stability !== undefined ? { stability } : {}),
    ...(similarityBoost !== undefined ? { similarityBoost } : {}),
    ...(style !== undefined ? { style } : {}),
    speakerBoost: settings?.speakerBoost ?? true,
    ...(speed !== undefined ? { speed } : {}),
  };
}

const voiceSettingsValidator = v.object({
  stability: v.optional(v.number()),
  similarityBoost: v.optional(v.number()),
  style: v.optional(v.number()),
  speakerBoost: v.optional(v.boolean()),
  speed: v.optional(v.number()),
});

function normalizeAccent(accent: EnglishAccent | undefined): EnglishAccent {
  return accent ?? "all";
}

function voiceRefForName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? `elevenlabs-${slug}` : "elevenlabs-voice";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.slice(i, i + 8192));
  }
  return btoa(binary);
}

function requireElevenLabsKey(): string {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) appError(AppErrorCode.TTS_NOT_CONFIGURED);
  return apiKey;
}

export const assertAdminForVoiceAction = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return null;
  },
});

export const assertAuditionRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    if (!VOICE_EDIT_RUN_STATES.has(run.state)) {
      appError(AppErrorCode.RUN_NOT_AT_GATE);
    }
    if (!run.courseId) appError(AppErrorCode.COURSE_NOT_FOUND);
    return null;
  },
});

export const adminListVoices = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.pipeline.tts.voice.assertAdminForVoiceAction, {});
    const apiKey = requireElevenLabsKey();
    const response = await fetch(ELEVENLABS_VOICES_URL, {
      headers: { "xi-api-key": apiKey },
    });
    if (!response.ok) appError(AppErrorCode.TTS_AUDITION_FAILED);
    const body = (await response.json()) as {
      voices?: Array<{
        voice_id?: string;
        name?: string;
        category?: string;
        description?: string;
        preview_url?: string;
        labels?: Record<string, string>;
      }>;
    };
    return (body.voices ?? [])
      .filter((voice) => voice.voice_id && voice.name)
      .map((voice) => ({
        voiceId: voice.voice_id as string,
        name: voice.name as string,
        category: voice.category ?? null,
        description: voice.description ?? null,
        previewUrl: voice.preview_url ?? null,
        labels: voice.labels ?? {},
      }))
      .slice(0, 80);
  },
});

export const adminAuditionVoice = action({
  args: {
    runId: v.id("runs"),
    voiceId: v.string(),
    text: v.string(),
    accent: v.optional(accentValidator),
    settings: v.optional(voiceSettingsValidator),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.pipeline.tts.voice.assertAuditionRun, {
      runId: args.runId,
    });
    const voiceId = args.voiceId.trim();
    const text = args.text.trim().slice(0, MAX_AUDITION_TEXT_CHARS);
    if (!voiceId || !text) appError(AppErrorCode.TTS_VOICE_INVALID);

    const settings = normalizeSettings(args.settings);
    const provider = createElevenLabsProvider({
      apiKey: requireElevenLabsKey(),
      model: ttsModel(),
    });
    try {
      const result = await provider.synthesize({
        text,
        voiceId,
        accent: normalizeAccent(args.accent),
        ...(settings.stability !== undefined ? { stability: settings.stability } : {}),
        ...(settings.similarityBoost !== undefined
          ? { similarityBoost: settings.similarityBoost }
          : {}),
        ...(settings.style !== undefined ? { style: settings.style } : {}),
        ...(settings.speakerBoost !== undefined
          ? { speakerBoost: settings.speakerBoost }
          : {}),
        ...(settings.speed !== undefined ? { speed: settings.speed } : {}),
      });
      await ctx.runMutation(internal.pipeline.tts.calls.recordTtsCall, {
        runId: args.runId,
        stage: "voice-audition",
        provider: provider.name,
        model: result.model,
        voiceId,
        characters: result.characters,
        latencyMs: result.latencyMs,
      });
      return {
        audioBase64: arrayBufferToBase64(result.audio),
        contentType: "audio/mpeg",
        characters: result.characters,
        model: result.model,
      };
    } catch {
      appError(AppErrorCode.TTS_AUDITION_FAILED);
    }
  },
});

export const adminSetCourseVoice = mutation({
  args: {
    runId: v.id("runs"),
    voiceId: v.string(),
    name: v.string(),
    accent: v.optional(accentValidator),
    settings: v.optional(voiceSettingsValidator),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    if (!VOICE_EDIT_RUN_STATES.has(run.state)) {
      appError(AppErrorCode.RUN_NOT_AT_GATE);
    }
    if (!run.courseId) appError(AppErrorCode.COURSE_NOT_FOUND);
    const course = await ctx.db.get(run.courseId);
    if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);

    const voiceId = args.voiceId.trim();
    const name = args.name.trim();
    if (!voiceId || !name) appError(AppErrorCode.TTS_VOICE_INVALID);
    const settings = normalizeSettings(args.settings);
    const accent = normalizeAccent(args.accent);
    const meta = (course.definitionMeta ?? {}) as {
      voice?: {
        provider: string;
        voiceRef: string;
        pronunciationLexicon: Record<string, string>;
      };
      [key: string]: unknown;
    };
    const voiceRef = voiceRefForName(name);
    await ctx.db.patch(course._id, {
      definitionMeta: {
        ...meta,
        voice: {
          provider: "elevenlabs",
          voiceRef,
          pronunciationLexicon: meta.voice?.pronunciationLexicon ?? {},
        },
        ttsVoice: {
          provider: "elevenlabs",
          voiceRef,
          voiceId,
          name,
          accent,
          settings,
        },
      },
    });
    return null;
  },
});
