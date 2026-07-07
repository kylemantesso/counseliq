/**
 * Deterministic mock TTS provider for unit tests, CI, and free walkthrough
 * rehearsals (TTS_PROVIDER=mock). Every character takes exactly 50ms; the
 * "audio" is the UTF-8 bytes of a stable marker string, so content-addressed
 * keys are reproducible across runs.
 */

import type { TtsProvider, TtsSynthesizeResult } from "./provider";
import { TtsError } from "./provider";

/** Embedding this marker in a sentence makes the mock fail (tests C2's
 *  failed-unit path without touching the real provider). */
export const MOCK_TTS_FAIL_MARKER = "[[TTS_FAIL]]";

const MS_PER_CHARACTER = 50;

export function createMockTtsProvider(): TtsProvider {
  return {
    name: "mock",

    async synthesize(input): Promise<TtsSynthesizeResult> {
      if (input.text.includes(MOCK_TTS_FAIL_MARKER)) {
        throw new TtsError("mock TTS failure marker present", false);
      }
      const characters = [...input.text];
      const startSeconds = characters.map((_, i) => (i * MS_PER_CHARACTER) / 1000);
      const endSeconds = characters.map(
        (_, i) => ((i + 1) * MS_PER_CHARACTER) / 1000
      );
      const audio = new TextEncoder().encode(`mock-audio:${input.text}`);
      return {
        audio: audio.buffer as ArrayBuffer,
        timestamps: { characters, startSeconds, endSeconds },
        model: "mock-tts-1",
        characters: input.text.length,
        latencyMs: 1,
      };
    },
  };
}
