/**
 * ElevenLabs TTS adapter (native fetch, default Convex runtime).
 *
 * Endpoint verified against the ElevenLabs API reference (2026-07):
 * POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=...
 * headers: xi-api-key; body: { text, model_id, previous_text?, next_text?,
 * apply_text_normalization }; response: { audio_base64, alignment:
 * { characters, character_start_times_seconds, character_end_times_seconds },
 * normalized_alignment }.
 *
 * We send `apply_text_normalization: "off"` — the pipeline's deterministic
 * normaliser owns number/date expansion — and read `alignment` (timestamps
 * against OUR request text), never `normalized_alignment`.
 *
 * Retry policy mirrors the OpenRouter client: 429/5xx retryable honouring
 * retry-after (capped), exponential backoff otherwise; other non-OK statuses
 * are non-retryable. The API key is never logged and never appears in error
 * messages.
 */

import type {
  TtsCharacterTimestamps,
  TtsProvider,
  TtsSynthesizeInput,
  TtsSynthesizeResult,
} from "./provider";
import { TtsError } from "./provider";

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const MAX_TRANSPORT_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 2_000;
const MAX_RETRY_AFTER_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

interface ElevenLabsAlignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

interface ElevenLabsResponse {
  audio_base64?: string;
  alignment?: ElevenLabsAlignment;
  normalized_alignment?: ElevenLabsAlignment;
}

export function createElevenLabsProvider(options?: {
  apiKey?: string;
  model?: string;
  outputFormat?: string;
  fetchImpl?: typeof fetch;
}): TtsProvider {
  const apiKey = options?.apiKey ?? process.env.ELEVENLABS_API_KEY;
  const model = options?.model ?? "eleven_multilingual_v2";
  const outputFormat = options?.outputFormat ?? "mp3_44100_128";
  const fetchImpl = options?.fetchImpl ?? fetch;

  async function requestOnce(input: TtsSynthesizeInput): Promise<Response> {
    const url =
      `${ELEVENLABS_BASE_URL}/${encodeURIComponent(input.voiceId)}` +
      `/with-timestamps?output_format=${encodeURIComponent(outputFormat)}`;
    return await fetchImpl(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: input.text,
        model_id: model,
        // The pipeline normaliser owns expansion; provider normalisation off
        // keeps `alignment` 1:1 with the request text.
        apply_text_normalization: "off",
        ...(input.previousText ? { previous_text: input.previousText } : {}),
        ...(input.nextText ? { next_text: input.nextText } : {}),
      }),
    });
  }

  return {
    name: "elevenlabs",

    async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
      if (!apiKey) {
        throw new TtsError("ELEVENLABS_API_KEY is not configured", false);
      }

      for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt++) {
        const startedAt = Date.now();
        const response = await requestOnce(input);

        if (response.status === 429 || response.status >= 500) {
          if (attempt === MAX_TRANSPORT_ATTEMPTS) {
            throw new TtsError(
              `ElevenLabs ${response.status} after ${attempt} attempts (voice ${input.voiceId}, model ${model})`,
              true
            );
          }
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterMs = retryAfterHeader
            ? Math.min(Number(retryAfterHeader) * 1000, MAX_RETRY_AFTER_MS)
            : 0;
          const backoffMs = Math.max(
            retryAfterMs,
            BASE_BACKOFF_MS * 2 ** (attempt - 1)
          );
          await sleep(backoffMs);
          continue;
        }

        if (!response.ok) {
          const errorText = (await response.text()).slice(0, 500);
          throw new TtsError(
            `ElevenLabs ${response.status} (voice ${input.voiceId}, model ${model}): ${errorText}`,
            false
          );
        }

        const payload = (await response.json()) as ElevenLabsResponse;
        const alignment = payload.alignment;
        if (
          !payload.audio_base64 ||
          !alignment?.characters ||
          !alignment.character_start_times_seconds ||
          !alignment.character_end_times_seconds
        ) {
          throw new TtsError(
            `ElevenLabs returned an incomplete payload (voice ${input.voiceId}, model ${model})`,
            true
          );
        }
        const timestamps: TtsCharacterTimestamps = {
          characters: alignment.characters,
          startSeconds: alignment.character_start_times_seconds,
          endSeconds: alignment.character_end_times_seconds,
        };
        return {
          audio: base64ToArrayBuffer(payload.audio_base64),
          timestamps,
          model,
          characters: input.text.length,
          latencyMs: Date.now() - startedAt,
        };
      }
      throw new TtsError(`ElevenLabs retries exhausted (model ${model})`, true);
    },
  };
}
