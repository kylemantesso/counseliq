import { Composition } from "remotion";
import type { ComponentType } from "react";
import {
  contentEndMsForTiming,
  type RenderProfile,
  type UnitTiming,
} from "@counseliq/course-schema";
import { UnitContentComposition, type UnitContentCompositionProps } from "./unit-content-composition";

const FALLBACK_PROFILE: RenderProfile = {
  container: "mp4",
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: "h264",
  audioCodec: "aac",
};

const FALLBACK_TIMING: UnitTiming = {
  version: 2,
  unitKey: "fallback",
  provider: "fallback",
  voiceRef: "fallback",
  model: "fallback",
  interSentenceGapMs: 0,
  totalDurationMs: 1000,
  sentences: [
    {
      narrationId: "n1",
      speakText: "fallback",
      audioKey: "sha256/fallback.mp3",
      startMs: 0,
      durationMs: 1000,
      words: [{ text: "fallback", startMs: 0, endMs: 1000 }],
    },
  ],
  cardBeats: [],
  media: [],
  generatedAt: Date.now(),
};

const FALLBACK_PROPS: UnitContentCompositionProps = {
  unit: {
    unitId: "fallback",
    concept: "fallback",
    secondsBudget: 1,
    hook: { type: "commit-question", questionRef: "q1" },
    content: {
      narration: [{ id: "n1", text: "fallback" }],
      cards: [],
    },
    retrieve: [],
    anchor: { template: "takeaway-card", props: { text: "fallback" } },
  },
  timing: FALLBACK_TIMING,
  profile: FALLBACK_PROFILE,
  themeTokens: {},
  assetUrls: {},
  sentenceAudioUrls: {},
  institutionLogoUrl: null,
};

const LooseUnitContentComposition =
  UnitContentComposition as unknown as ComponentType<Record<string, unknown>>;

export function RemotionRoot() {
  return (
    <Composition
      id="unit-content-video"
      component={LooseUnitContentComposition}
      defaultProps={FALLBACK_PROPS}
      durationInFrames={30}
      fps={30}
      width={1080}
      height={1920}
      calculateMetadata={({ props }) => {
        const typed = props as unknown as UnitContentCompositionProps;
        const fps = typed.profile.fps;
        const durationInFrames = Math.max(
          1,
          Math.ceil((contentEndMsForTiming(typed.timing) / 1000) * fps)
        );
        return {
          durationInFrames,
          fps,
          width: typed.profile.width,
          height: typed.profile.height,
        };
      }}
    />
  );
}
