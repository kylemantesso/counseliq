import type { UnitScript, UnitTiming } from "@counseliq/course-schema";

/**
 * Local view-model for the gate-3 preview payload (adminGetRunPreview).
 * The player is written against these shapes so it can also be driven by
 * synthetic data in tests and the dev gallery; the gate-3 screen maps the
 * real query result onto RunPreviewData.
 */

export interface PreviewNarrationSentence {
  id: string;
  text: string;
}

export interface PreviewCard {
  template: string;
  props: Record<string, unknown>;
  visualTreatment?: "standard" | "avatar-overlay";
  enterAt: { narration: string; word: string };
  provenance: string;
}

export interface PreviewAnchor {
  template: string;
  props: Record<string, unknown>;
}

export interface PreviewQuestion {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export type PreviewUnitState =
  | "draft"
  | "blocked"
  | "script_ready"
  | "assets_ready"
  | "qa_passed"
  | "published";

export interface PreviewUnit {
  /** microUnits document id (string form). */
  id: string;
  unitKey: string;
  concept: string;
  state: PreviewUnitState;
  error?: { retryable: boolean; cause: string } | null;
  narration: PreviewNarrationSentence[];
  cards: PreviewCard[];
  meta: {
    hook?: { questionRef: string } | null;
    retrieve?: string[];
    anchor?: PreviewAnchor | null;
    secondsBudget?: number;
  };
  script?: UnitScript | null;
  timing?: UnitTiming | null;
  avatarTrack?: { objectKey: string; durationMs: number } | null;
}

export interface PreviewModule {
  moduleKey: string;
  moduleTitle: string;
  units: PreviewUnit[];
}

/** Catalogue asset metadata for refs used in the course (M6 media). */
export interface PreviewAsset {
  objectKey: string;
  /** Thumbnail for images; poster frame for video. */
  thumbKey?: string;
  kind: "image" | "video";
  durationMs?: number;
}

export interface RunPreviewData {
  runId: string;
  runState: string;
  course: { title: string; version: number; brandRef?: string | null };
  institution: { name: string; brandTokens?: unknown };
  modules: PreviewModule[];
  questions: PreviewQuestion[];
  /** assetRef (assets._id) → object-store keys, for cards' media. */
  assets?: Record<string, PreviewAsset>;
  summary?: {
    ready: number;
    blocked: number;
    failed: number;
    totalDurationMs?: number;
  };
}

/** The four phases of a unit, in studio/player order. */
export type UnitPhase = "hook" | "content" | "retrieve" | "anchor";
