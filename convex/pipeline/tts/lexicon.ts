/**
 * Pronunciation-lexicon utilities. The stored narration and normalised
 * `speakText` stay human-readable; pronunciation respellings are substituted
 * into the text sent to the TTS provider at request time. A lexicon value of
 * `CONFIRM_WITH_INSTITUTION` is the unresolved-pronunciation sentinel: the
 * term must NOT be substituted, and any unit whose narration uses it is
 * blocked until an operator resolves the entry.
 */

import type { AlignmentSegment } from "./normalize";

export const LEXICON_SENTINEL = "CONFIRM_WITH_INSTITUTION";

/** Maps a span of `speakText` to a span of the substituted `spokenText`. */
export interface SubstitutionSegment {
  normStart: number;
  normEnd: number;
  spokenStart: number;
  spokenEnd: number;
  kind: "copy" | "expand";
}

export interface SubstitutionMap {
  spokenText: string;
  segments: SubstitutionSegment[];
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}

/** All word-boundary occurrences of `key` in `text`, as start offsets. */
function boundaryOccurrences(text: string, key: string): number[] {
  const starts: number[] = [];
  let from = 0;
  while (from <= text.length - key.length) {
    const idx = text.indexOf(key, from);
    if (idx === -1) break;
    if (!isWordChar(text[idx - 1]) && !isWordChar(text[idx + key.length])) {
      starts.push(idx);
    }
    from = idx + 1;
  }
  return starts;
}

/**
 * Substitute lexicon respellings into `speakText`, producing the provider
 * request text plus a span mapping. Longest key wins on overlap; matches are
 * word-boundary and case-sensitive; sentinel-valued keys are skipped.
 */
export function buildSubstitutionMap(
  speakText: string,
  lexicon: Record<string, string>,
): SubstitutionMap {
  interface Candidate {
    start: number;
    end: number;
    replacement: string;
  }
  const keys = Object.keys(lexicon)
    .filter((k) => k.length > 0 && lexicon[k] !== LEXICON_SENTINEL)
    .sort((a, b) => b.length - a.length);

  const accepted: Candidate[] = [];
  for (const key of keys) {
    for (const start of boundaryOccurrences(speakText, key)) {
      const end = start + key.length;
      const overlaps = accepted.some((c) => c.start < end && start < c.end);
      if (!overlaps) accepted.push({ start, end, replacement: lexicon[key] });
    }
  }
  accepted.sort((a, b) => a.start - b.start);

  const segments: SubstitutionSegment[] = [];
  let spokenText = "";
  let cursor = 0;
  const pushCopy = (start: number, end: number) => {
    if (end <= start) return;
    const content = speakText.slice(start, end);
    segments.push({
      normStart: start,
      normEnd: end,
      spokenStart: spokenText.length,
      spokenEnd: spokenText.length + content.length,
      kind: "copy",
    });
    spokenText += content;
  };
  for (const match of accepted) {
    pushCopy(cursor, match.start);
    segments.push({
      normStart: match.start,
      normEnd: match.end,
      spokenStart: spokenText.length,
      spokenEnd: spokenText.length + match.replacement.length,
      kind: "expand",
    });
    spokenText += match.replacement;
    cursor = match.end;
  }
  pushCopy(cursor, speakText.length);

  return { spokenText, segments };
}

/**
 * Lexicon keys whose pronunciation is unresolved (sentinel value) and which
 * appear, word-boundary, in the given text. Non-empty ⇒ the unit is blocked.
 */
export function findBlockedTerms(
  text: string,
  lexicon: Record<string, string>,
): string[] {
  return Object.keys(lexicon)
    .filter(
      (key) =>
        key.length > 0 &&
        lexicon[key] === LEXICON_SENTINEL &&
        boundaryOccurrences(text, key).length > 0,
    )
    .sort();
}

// --- Span projection (shared by beat resolution) ---

/** Direction-neutral span mapping: input span → output span. */
export interface SpanSegment {
  inStart: number;
  inEnd: number;
  outStart: number;
  outEnd: number;
  kind: "copy" | "expand";
}

export function alignmentToSpans(alignment: readonly AlignmentSegment[]): SpanSegment[] {
  return alignment.map((s) => ({
    inStart: s.origStart,
    inEnd: s.origEnd,
    outStart: s.normStart,
    outEnd: s.normEnd,
    kind: s.kind,
  }));
}

export function substitutionToSpans(
  segments: readonly SubstitutionSegment[],
): SpanSegment[] {
  return segments.map((s) => ({
    inStart: s.normStart,
    inEnd: s.normEnd,
    outStart: s.spokenStart,
    outEnd: s.spokenEnd,
    kind: s.kind,
  }));
}

/**
 * Project an input-side span through a segment list. Copy overlaps map
 * character-for-character; any overlap with an expand segment claims the
 * segment's whole output span (a rewritten phrase is atomic). Returns the
 * union of the projected pieces; a span touching no segment projects to a
 * zero-length span at the nearest following output position.
 */
export function projectSpan(
  segments: readonly SpanSegment[],
  span: readonly [number, number],
): [number, number] {
  const [start, end] = span;
  let outStart = Number.POSITIVE_INFINITY;
  let outEnd = Number.NEGATIVE_INFINITY;
  for (const seg of segments) {
    if (seg.inEnd <= start || seg.inStart >= end) continue;
    if (seg.kind === "expand") {
      outStart = Math.min(outStart, seg.outStart);
      outEnd = Math.max(outEnd, seg.outEnd);
    } else {
      outStart = Math.min(outStart, seg.outStart + Math.max(0, start - seg.inStart));
      outEnd = Math.max(outEnd, seg.outStart + Math.min(seg.inEnd, end) - seg.inStart);
    }
  }
  if (outStart === Number.POSITIVE_INFINITY) {
    const following = segments.find((seg) => seg.inStart >= end);
    const at = following
      ? following.outStart
      : segments.length > 0
        ? segments[segments.length - 1].outEnd
        : 0;
    return [at, at];
  }
  return [outStart, outEnd];
}
