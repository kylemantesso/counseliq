import type { PreviewAsset, PreviewModule, PreviewUnit, UnitPhase } from "./types";

/**
 * Pure sequencing/derivation helpers for the player. Everything here is
 * platform-neutral and unit-tested (packages/app vitest); the audio hook
 * stays a thin shell over these decisions.
 *
 * All times are unit-clock milliseconds (see UnitTiming in course-schema).
 */

export interface SentenceWindow {
  startMs: number;
  durationMs: number;
}

interface TimingLike {
  sentences: SentenceWindow[];
  totalDurationMs: number;
}

/**
 * The sentence whose [startMs, startMs + durationMs) window contains the
 * clock, or null when the clock is in an inter-sentence gap or past the end.
 */
export function sentenceForClock(sentences: SentenceWindow[], ms: number): number | null {
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (ms >= s.startMs && ms < s.startMs + s.durationMs) return i;
  }
  return null;
}

/**
 * Where a scrub/seek to `ms` should land: the containing sentence with an
 * in-sentence offset, or — when `ms` falls in a gap — the next sentence at
 * offset 0. null only past the final sentence's end.
 */
export function seekTarget(
  sentences: SentenceWindow[],
  ms: number
): { sentenceIndex: number; offsetMs: number } | null {
  const clamped = Math.max(0, ms);
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (clamped < s.startMs) return { sentenceIndex: i, offsetMs: 0 };
    if (clamped < s.startMs + s.durationMs) {
      return { sentenceIndex: i, offsetMs: clamped - s.startMs };
    }
  }
  return null;
}

/** What playback does after sentence `endedIndex` finishes. */
export type SequenceAction =
  | { kind: "play"; sentenceIndex: number }
  | { kind: "wait-gap"; untilMs: number; sentenceIndex: number }
  | { kind: "ended" };

/**
 * After a sentence's audio ends: play the next sentence immediately, wait
 * out an artifact-defined gap first (the clock free-runs to `untilMs`), or
 * report the unit ended.
 */
export function nextAfterSentence(timing: TimingLike, endedIndex: number): SequenceAction {
  const next = endedIndex + 1;
  if (next >= timing.sentences.length) return { kind: "ended" };
  const ended = timing.sentences[endedIndex];
  const endedAt = ended.startMs + ended.durationMs;
  const nextStart = timing.sentences[next].startMs;
  if (nextStart > endedAt) {
    return { kind: "wait-gap", untilMs: nextStart, sentenceIndex: next };
  }
  return { kind: "play", sentenceIndex: next };
}

/**
 * Phase fractions for the course progress bar, ported from the design
 * mockup (hook 0.12, content 0.15→0.80, anchor 0.92).
 */
export function phaseFraction(phase: UnitPhase, contentProgress = 0): number {
  switch (phase) {
    case "hook":
      return 0.12;
    case "content":
      return 0.15 + 0.65 * Math.min(1, Math.max(0, contentProgress));
    case "retrieve":
      return 0.85;
    case "anchor":
      return 0.92;
  }
}

/** Course progress percent across all units. */
export function courseProgressPct(
  flatUnitIndex: number,
  totalUnits: number,
  fraction: number
): number {
  if (totalUnits <= 0) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.min(100, ((flatUnitIndex + clamped) / totalUnits) * 100);
}

export interface FlatUnit {
  unit: PreviewUnit;
  module: PreviewModule;
  moduleIndex: number;
  unitIndexInModule: number;
  flatIndex: number;
}

/** Modules → a flat, ordered unit list with module context. */
export function flattenUnits(modules: PreviewModule[]): FlatUnit[] {
  const flat: FlatUnit[] = [];
  modules.forEach((module, moduleIndex) => {
    module.units.forEach((unit, unitIndexInModule) => {
      flat.push({ unit, module, moduleIndex, unitIndexInModule, flatIndex: flat.length });
    });
  });
  return flat;
}

/** `93_500` → `"1:33"`. */
export function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** The ordered phases a unit actually has (hook/retrieve may be absent). */
export function phasesForUnit(unit: PreviewUnit): UnitPhase[] {
  const phases: UnitPhase[] = [];
  if (unit.meta.hook?.questionRef) phases.push("hook");
  phases.push("content");
  if ((unit.meta.retrieve ?? []).length > 0) phases.push("retrieve");
  if (unit.meta.anchor) phases.push("anchor");
  return phases;
}

/** The phase that follows `phase` for this unit, or null at the end. */
export function nextPhase(unit: PreviewUnit, phase: UnitPhase): UnitPhase | null {
  const phases = phasesForUnit(unit);
  const at = phases.indexOf(phase);
  if (at < 0 || at + 1 >= phases.length) return null;
  return phases[at + 1];
}

/** Every assetRef used by a unit's cards + anchor (M6 media). */
export function assetRefsForUnit(unit: PreviewUnit): string[] {
  const refs: string[] = [];
  const fromProps = (props: Record<string, unknown> | undefined) => {
    const ref = props?.assetRef;
    if (typeof ref === "string" && ref.length > 0) refs.push(ref);
  };
  for (const card of unit.cards) fromProps(card.props);
  fromProps(unit.meta.anchor?.props);
  return refs;
}

/**
 * Object-store keys the player needs for a set of units' media (video/image
 * bytes + posters/thumbs). Pure, so preloading the NEXT unit's media is the
 * same call one index ahead.
 */
export function mediaKeysForUnits(
  units: Array<PreviewUnit | undefined>,
  assets: Record<string, PreviewAsset> | undefined
): string[] {
  if (!assets) return [];
  const keys = new Set<string>();
  for (const unit of units) {
    if (!unit) continue;
    for (const ref of assetRefsForUnit(unit)) {
      const asset = assets[ref];
      if (!asset) continue;
      keys.add(asset.objectKey);
      if (asset.thumbKey) keys.add(asset.thumbKey);
    }
  }
  return [...keys];
}

/**
 * AssetResolver mapping for the cards package: `<assetRef>` resolves to the
 * asset's presigned objectKey URL, `poster:<assetRef>` to its thumb/poster.
 * Legacy loose imageRef strings resolve to null (themed placeholder).
 */
export function resolveAssetUrl(
  ref: string,
  assets: Record<string, PreviewAsset> | undefined,
  urls: ReadonlyMap<string, string>
): string | null {
  if (!assets) return null;
  const posterRequest = ref.startsWith("poster:");
  const asset = assets[posterRequest ? ref.slice("poster:".length) : ref];
  if (!asset) return null;
  const key = posterRequest ? asset.thumbKey : asset.objectKey;
  return key !== undefined ? (urls.get(key) ?? null) : null;
}
