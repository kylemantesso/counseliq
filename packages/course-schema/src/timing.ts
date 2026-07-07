import { z } from "zod";

/**
 * M5 timing contracts — the versioned artifacts produced by
 * GENERATING_SCRIPT (UnitScript) and GENERATING_ASSETS (UnitTiming).
 *
 * UnitTiming is the single clock the gate-3 player consumes now and the
 * Remotion renderer consumes in M6: any field change requires bumping
 * TIMING_VERSION, and consumers must check `version` before reading.
 *
 * All times are integer milliseconds on the UNIT clock (t=0 at the start of
 * the unit's first sentence), never sentence-local.
 */

// ---------------------------------------------------------------------------
// UnitScript (stored on microUnits.script, written by GENERATING_SCRIPT)
// ---------------------------------------------------------------------------

export const scriptAlignmentSegmentSchema = z
  .object({
    /** [start, end) character span into sourceText. */
    origStart: z.number().int().nonnegative(),
    origEnd: z.number().int().nonnegative(),
    /** [start, end) character span into speakText. */
    normStart: z.number().int().nonnegative(),
    normEnd: z.number().int().nonnegative(),
    /** copy = verbatim text, expand = rewritten for speech. */
    kind: z.enum(["copy", "expand"]),
  })
  .strict();

export const scriptSentenceSchema = z
  .object({
    /** microUnits.narration[].id — keeps edits round-trippable. */
    narrationId: z.string().min(1),
    /** The original narration text at normalise time. */
    sourceText: z.string().min(1),
    /** Normalised, human-readable speech text (no phonetic respellings). */
    speakText: z.string().min(1),
    /** Segments jointly covering sourceText and speakText with no gaps. */
    alignment: z.array(scriptAlignmentSegmentSchema).min(1),
    /** Lexicon keys present in this sentence whose pronunciation is the
     *  CONFIRM_WITH_INSTITUTION sentinel — non-empty blocks the unit. */
    blockedTerms: z.array(z.string()),
  })
  .strict();

export const unitScriptSchema = z
  .object({
    version: z.literal(1),
    /** e.g. "normalize@1" — a bump invalidates cached synthesis. */
    normalizerVersion: z.string().min(1),
    sentences: z.array(scriptSentenceSchema).min(1),
    generatedAt: z.number(),
  })
  .strict();

// ---------------------------------------------------------------------------
// UnitTiming (stored on microUnits.timing, written by GENERATING_ASSETS)
// ---------------------------------------------------------------------------

export const TIMING_VERSION = 1 as const;

export const timingWordSchema = z
  .object({
    /** Token of speakText (display-safe, used for captions). */
    text: z.string().min(1),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  })
  .strict();

export const timingSentenceSchema = z
  .object({
    narrationId: z.string().min(1),
    speakText: z.string().min(1),
    /** Per-sentence audio artifact: sha256/{hash}.mp3 in the object store. */
    audioKey: z.string().min(1),
    startMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
    words: z.array(timingWordSchema).min(1),
  })
  .strict();

export const cardBeatSchema = z
  .object({
    /** Index into microUnits.cards. */
    cardIndex: z.number().int().nonnegative(),
    /** Resolved enterAt time on the unit clock. */
    atMs: z.number().int().nonnegative(),
  })
  .strict();

export const unitTimingSchema = z
  .object({
    version: z.literal(TIMING_VERSION),
    unitKey: z.string().min(1),
    provider: z.string().min(1),
    voiceRef: z.string().min(1),
    model: z.string().min(1),
    /** Constant silence inserted between sentences on the unit clock. */
    interSentenceGapMs: z.number().int().nonnegative(),
    totalDurationMs: z.number().int().positive(),
    sentences: z.array(timingSentenceSchema).min(1),
    cardBeats: z.array(cardBeatSchema),
    generatedAt: z.number(),
  })
  .strict();

export type ScriptAlignmentSegment = z.infer<typeof scriptAlignmentSegmentSchema>;
export type ScriptSentence = z.infer<typeof scriptSentenceSchema>;
export type UnitScript = z.infer<typeof unitScriptSchema>;
export type TimingWord = z.infer<typeof timingWordSchema>;
export type TimingSentence = z.infer<typeof timingSentenceSchema>;
export type CardBeat = z.infer<typeof cardBeatSchema>;
export type UnitTiming = z.infer<typeof unitTimingSchema>;
