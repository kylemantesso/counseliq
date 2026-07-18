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
 * Output format is part of the unit content hash, so changing it regenerates
 * every unit narration track.
 */
export const OUTPUT_FORMAT = "mp3_44100_128";

/**
 * STATIC default narrator fallback: ElevenLabs' premade "Matilda —
 * Knowledgable, Professional" (XrExE9yKIg1WjnnlVkGX), part of every
 * account's default premade set. The primary default is discovered from
 * the account's own voice list at synthesis time (free tiers 402 on
 * voices outside their list — see fetchAccountDefaultVoice); this static
 * value covers env override and listing failures. Brands get their own
 * narrator via institutions.voiceConfig.
 */
export function defaultVoice(): { voiceId: string; voiceRef: string } {
  const override = process.env.TTS_DEFAULT_VOICE_ID;
  return {
    voiceId:
      override && override.trim() !== ""
        ? override.trim()
        : "XrExE9yKIg1WjnnlVkGX",
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
 * Concurrent synthesis actions. ElevenLabs caps are plan-tier dependent and
 * local/dev accounts can 429 even at low concurrency, so default to serial
 * synthesis unless TTS_PARALLELISM explicitly opts into faster fan-out.
 */
export function ttsParallelism(): number {
  const parsed = Number(process.env.TTS_PARALLELISM);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
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
