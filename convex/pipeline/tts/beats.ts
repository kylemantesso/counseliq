/**
 * Word-timestamp derivation, unit-clock assembly, and card beat resolution.
 *
 * Pure functions over the three text layers of a sentence:
 *
 *   sourceText --(script alignment)--> speakText --(lexicon substitution
 *   segments)--> spokenText --(provider character timestamps)--> time
 *
 * `enterAt.word` anchors are authored against sourceText; timestamps are
 * measured against spokenText. Resolution projects the anchor span forward
 * through both mappings, then takes the earliest overlapping word's start.
 */

import type {
  CardBeat,
  MediaWindow,
  TimingSentence,
  TimingWord,
  UnitScript,
  UnitTiming,
} from "@counseliq/course-schema";
import { unitTimingSchema, TIMING_VERSION } from "@counseliq/course-schema";
import {
  alignmentToSpans,
  projectSpan,
  substitutionToSpans,
  type SubstitutionSegment,
} from "./lexicon";
import type { TtsCharacterTimestamps } from "./provider";

/** A word of spokenText with char offsets (mirrors ttsSentences.words). */
export interface SpokenWord {
  text: string;
  startMs: number;
  endMs: number;
  charStart: number;
  charEnd: number;
}

/** Whitespace-delimited word spans of a text, with [start, end) offsets. */
export function tokenizeWords(
  text: string
): Array<{ text: string; start: number; end: number }> {
  const words: Array<{ text: string; start: number; end: number }> = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    words.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return words;
}

/**
 * Word timestamps from provider character timestamps. startMs = start of the
 * word's first character, endMs = end of its last, integer-rounded.
 */
export function deriveWords(
  spokenText: string,
  timestamps: TtsCharacterTimestamps
): SpokenWord[] {
  return tokenizeWords(spokenText).map((word) => ({
    text: word.text,
    startMs: Math.round((timestamps.startSeconds[word.start] ?? 0) * 1000),
    endMs: Math.round((timestamps.endSeconds[word.end - 1] ?? 0) * 1000),
    charStart: word.start,
    charEnd: word.end,
  }));
}

/**
 * Sentence-local caption words: each speakText word inherits the time range
 * of the spokenText words its substituted span overlaps. Words inside a
 * lexicon expansion share the whole expansion's range (a respelled name
 * spans its full utterance).
 */
export function projectWordsToSpeakText(
  speakText: string,
  substitutionSegments: readonly SubstitutionSegment[],
  spokenWords: readonly SpokenWord[]
): TimingWord[] {
  const spans = substitutionToSpans(substitutionSegments);
  return tokenizeWords(speakText).map((word) => {
    const [spokenStart, spokenEnd] = projectSpan(spans, [word.start, word.end]);
    const overlapping = spokenWords.filter(
      (w) => w.charStart < spokenEnd && spokenStart < w.charEnd
    );
    if (overlapping.length === 0) {
      // Zero-length projection (shouldn't happen for real words): pin to the
      // nearest word boundary so captions never go backwards.
      const following = spokenWords.find((w) => w.charStart >= spokenEnd);
      const at = following?.startMs ?? spokenWords.at(-1)?.endMs ?? 0;
      return { text: word.text, startMs: at, endMs: at };
    }
    return {
      text: word.text,
      startMs: Math.min(...overlapping.map((w) => w.startMs)),
      endMs: Math.max(...overlapping.map((w) => w.endMs)),
    };
  });
}

export interface SentenceForAssembly {
  narrationId: string;
  speakText: string;
  audioKey: string;
  durationMs: number;
  /** Sentence-local caption words (from projectWordsToSpeakText). */
  words: TimingWord[];
}

/**
 * Lay sentences onto the unit clock: startMs accumulates durations plus a
 * constant inter-sentence gap; word times shift with their sentence.
 */
export function assembleUnitClock(
  sentences: readonly SentenceForAssembly[],
  gapMs: number
): TimingSentence[] {
  const out: TimingSentence[] = [];
  let clock = 0;
  for (const sentence of sentences) {
    out.push({
      narrationId: sentence.narrationId,
      speakText: sentence.speakText,
      audioKey: sentence.audioKey,
      startMs: clock,
      durationMs: sentence.durationMs,
      words: sentence.words.map((w) => ({
        text: w.text,
        startMs: w.startMs + clock,
        endMs: w.endMs + clock,
      })),
    });
    clock += sentence.durationMs + gapMs;
  }
  return out;
}

/**
 * Resolve every card's `enterAt {narration, word}` to a unit-clock beat.
 * Chain: first occurrence of the word in the referenced sentence's
 * sourceText → script alignment → speakText span → overlapping unit-clock
 * caption words → earliest word start. Falls back to the sentence start when
 * the chain cannot resolve (edited narration is guarded upstream; this keeps
 * beat resolution total).
 */
export function resolveCardBeats(
  cards: ReadonlyArray<{ enterAt: { narration: string; word: string } }>,
  script: UnitScript,
  timingSentences: readonly TimingSentence[]
): CardBeat[] {
  return cards.map((card, cardIndex) => {
    const scriptSentence = script.sentences.find(
      (s) => s.narrationId === card.enterAt.narration
    );
    const timingSentence = timingSentences.find(
      (s) => s.narrationId === card.enterAt.narration
    );
    if (!scriptSentence || !timingSentence) {
      return { cardIndex, atMs: timingSentence?.startMs ?? 0 };
    }

    const wordIdx = scriptSentence.sourceText.indexOf(card.enterAt.word);
    if (wordIdx === -1) {
      return { cardIndex, atMs: timingSentence.startMs };
    }

    const [speakStart, speakEnd] = projectSpan(
      alignmentToSpans(scriptSentence.alignment),
      [wordIdx, wordIdx + card.enterAt.word.length]
    );
    const speakWords = tokenizeWords(timingSentence.speakText);
    const overlappingTimes = speakWords
      .map((w, i) => ({ span: w, time: timingSentence.words[i] }))
      .filter(
        ({ span, time }) =>
          time !== undefined && span.start < speakEnd && speakStart < span.end
      )
      .map(({ time }) => time.startMs);

    if (overlappingTimes.length === 0) {
      return { cardIndex, atMs: timingSentence.startMs };
    }
    return { cardIndex, atMs: Math.min(...overlappingTimes) };
  });
}

/** Card templates whose active window plays/holds a media asset (M6). */
export const MEDIA_WINDOW_TEMPLATES: readonly string[] = [
  "video-card",
  "photo-kenburns",
  "image-text-card",
];

/**
 * Media playback windows (timing v2). A media card's window opens at its
 * beat and closes at the next beat in clock order (or unit end). Video is
 * additionally capped at the asset's duration — trim-if-longer; a shorter
 * clip holds its last frame for the rest of the card window (the window
 * itself stays the full card span, so `positionMs` keeps advancing and the
 * player knows to hold). Cards whose beat is shadowed by a simultaneous
 * later beat get no window.
 */
export function computeMediaWindows(
  cards: ReadonlyArray<{ template?: string; props?: Record<string, unknown> }>,
  cardBeats: readonly CardBeat[],
  totalDurationMs: number,
  assetDurations: ReadonlyMap<string, number>
): MediaWindow[] {
  // Same active-window semantics as the player: order beats by atMs (card
  // order breaking ties), each window runs to the next beat's atMs.
  const ordered = [...cardBeats].sort(
    (a, b) => a.atMs - b.atMs || a.cardIndex - b.cardIndex
  );
  const windows: MediaWindow[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const beat = ordered[i];
    const card = cards[beat.cardIndex];
    if (!card?.template || !MEDIA_WINDOW_TEMPLATES.includes(card.template)) {
      continue;
    }
    const assetRef = card.props?.assetRef;
    if (typeof assetRef !== "string" || assetRef.length === 0) continue;
    const windowEnd = ordered[i + 1]?.atMs ?? totalDurationMs;
    if (windowEnd <= beat.atMs) continue;
    const durationMs = assetDurations.get(assetRef);
    const outMs =
      durationMs !== undefined
        ? Math.min(windowEnd, beat.atMs + durationMs)
        : windowEnd;
    if (outMs <= beat.atMs) continue;
    windows.push({ cardIndex: beat.cardIndex, inMs: beat.atMs, outMs });
  }
  return windows.sort((a, b) => a.cardIndex - b.cardIndex);
}

/** Assemble and schema-validate the versioned per-unit timing artifact. */
export function buildUnitTiming(input: {
  unitKey: string;
  provider: string;
  voiceRef: string;
  model: string;
  gapMs: number;
  sentences: readonly TimingSentence[];
  cardBeats: readonly CardBeat[];
  media: readonly MediaWindow[];
  generatedAt: number;
}): UnitTiming {
  const last = input.sentences.at(-1);
  const totalDurationMs = last ? last.startMs + last.durationMs : 0;
  return unitTimingSchema.parse({
    version: TIMING_VERSION,
    unitKey: input.unitKey,
    provider: input.provider,
    voiceRef: input.voiceRef,
    model: input.model,
    interSentenceGapMs: input.gapMs,
    totalDurationMs,
    sentences: input.sentences,
    cardBeats: input.cardBeats,
    media: input.media,
    generatedAt: input.generatedAt,
  });
}
