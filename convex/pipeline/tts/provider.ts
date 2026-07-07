/**
 * Narrow TTS interface for the asset-generation pipeline. All pipeline code
 * depends on `TtsProvider`; ElevenLabs is the sole real implementation and
 * unit tests / CI substitute the deterministic mock. Never logs API keys or
 * presigned URLs.
 */

export interface TtsCharacterTimestamps {
  /** One entry per character of the request text, in order. */
  characters: string[];
  startSeconds: number[];
  endSeconds: number[];
}

export interface TtsSynthesizeInput {
  /** Spoken text: normalised speakText AFTER lexicon substitution. */
  text: string;
  voiceId: string;
  /** Prosody conditioning: the neighbouring sentences' spoken text. */
  previousText?: string;
  nextText?: string;
}

export interface TtsSynthesizeResult {
  /** Encoded audio bytes (mp3 for the default output format). */
  audio: ArrayBuffer;
  /** Character-level timestamps aligned to `input.text`. */
  timestamps: TtsCharacterTimestamps;
  model: string;
  /** Billed characters (= input.text.length; ElevenLabs bills per char). */
  characters: number;
  latencyMs: number;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult>;
}

export class TtsError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "TtsError";
  }
}
