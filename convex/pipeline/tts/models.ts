/**
 * TTS provider/model routing and synthesis constants. Mirrors the LLM
 * routing convention (`llm/models.ts`): env override wins, defaults are a
 * one-line change here. Eval/walkthrough output records the routed model, so
 * swaps are measurable.
 */

import { createElevenLabsProvider } from "./elevenlabs";
import { createMockTtsProvider } from "./mock";
import type { TtsProvider } from "./provider";

/**
 * Default synthesis model. eleven_multilingual_v2 is the quality narrator
 * model; eleven_flash_v2_5 is ~half the per-character credit cost and the
 * documented cheap swap (TTS_MODEL env).
 */
const DEFAULT_TTS_MODEL = "eleven_multilingual_v2";

/**
 * Output format is part of the sentence cache hash — changing it re-renders
 * every sentence.
 */
export const OUTPUT_FORMAT = "mp3_44100_128";

/** Constant silence inserted between sentences on the unit clock. */
export const INTER_SENTENCE_GAP_MS = 250;

/**
 * Default narrator when neither ELEVENLABS_VOICE_ID nor the institution's
 * voiceConfig names a voice: ElevenLabs' premade "Rachel"
 * (21m00Tcm4TlvDq8ikWAM), a stable premade voice available to every
 * account. Override per deployment with TTS_DEFAULT_VOICE_ID; brands get
 * their own narrator via institutions.voiceConfig.
 */
export function defaultVoice(): { voiceId: string; voiceRef: string } {
  const override = process.env.TTS_DEFAULT_VOICE_ID;
  return {
    voiceId:
      override && override.trim() !== ""
        ? override.trim()
        : "21m00Tcm4TlvDq8ikWAM",
    voiceRef: "counseliq-default",
  };
}

/** ElevenLabs model string (env override > default). */
export function ttsModel(): string {
  const override = process.env.TTS_MODEL;
  return override && override.trim() !== "" ? override.trim() : DEFAULT_TTS_MODEL;
}

/** Provider name: "elevenlabs" (default) or "mock" (tests, CI, rehearsals). */
export function ttsProviderName(): string {
  const override = process.env.TTS_PROVIDER;
  return override && override.trim() !== "" ? override.trim() : "elevenlabs";
}

/**
 * Concurrent synthesis actions. ElevenLabs concurrency caps are plan-tier
 * dependent (as low as a handful of concurrent requests), so the default is
 * deliberately conservative.
 */
export function ttsParallelism(): number {
  const parsed = Number(process.env.TTS_PARALLELISM);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 2;
}

/** Overall GENERATING_ASSETS deadline. */
export function ttsTimeoutMs(): number {
  const parsed = Number(process.env.TTS_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000;
}

/** Provider factory: TTS_PROVIDER=mock short-circuits ElevenLabs entirely. */
export function createProvider(): TtsProvider {
  return ttsProviderName() === "mock"
    ? createMockTtsProvider()
    : createElevenLabsProvider({ model: ttsModel() });
}
