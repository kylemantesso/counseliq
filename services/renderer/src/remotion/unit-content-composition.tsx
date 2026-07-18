import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  AssetResolverContext,
  AvatarOverlayCard,
  BrandThemeProvider,
  CAPTION_SAFE_HEIGHT,
  CardRenderer,
  MediaModeProvider,
  STAGE_WIDTH,
  brandThemeFromTokens,
  cssVar,
  deriveActiveCard,
  deriveActiveSentence,
} from "@counseliq/cards";
import type {
  CourseDefinition,
  RenderProfile,
  UnitTiming,
} from "@counseliq/course-schema";
import {
  fontFamilyFromThemeTokens,
  RemotionBrandFontLoader,
} from "./brand-fonts";
import {
  RemotionVisualAssetPreloader,
  visualAssetUrlsForUnit,
} from "./visual-asset-preloader";

type UnitDefinition = CourseDefinition["modules"][number]["microUnits"][number];

export interface UnitContentCompositionProps {
  unit: UnitDefinition;
  timing: UnitTiming;
  profile: RenderProfile;
  themeTokens: Record<string, unknown>;
  assetUrls: Record<string, string>;
  unitAudioUrl: string;
  avatarVideoUrl?: string | null;
  institutionLogoUrl?: string | null;
}

function withInstitutionLogo(
  template: string,
  props: Record<string, unknown>,
  logoUrl: string | null | undefined
): Record<string, unknown> {
  if (template !== "title-card") return props;
  if (!logoUrl) return props;
  if (typeof props.logoUrl === "string" && props.logoUrl.trim().length > 0) {
    return props;
  }
  return { ...props, logoUrl };
}

function CaptionOverlay({ timing, clockMs }: { timing: UnitTiming; clockMs: number }) {
  const { sentenceIndex, wordIndex } = deriveActiveSentence(timing, clockMs);
  let shownIndex = sentenceIndex;
  if (shownIndex === null) {
    for (let i = timing.sentences.length - 1; i >= 0; i -= 1) {
      if (timing.sentences[i].startMs <= clockMs) {
        shownIndex = i;
        break;
      }
    }
  }
  if (shownIndex === null) return null;
  const sentence = timing.sentences[shownIndex];
  const activeWord = sentenceIndex === null ? sentence.words.length - 1 : wordIndex;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: CAPTION_SAFE_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        padding: "0 18px 8px",
      }}
    >
      <div
        style={{
          background: cssVar("scrim"),
          color: cssVar("photoInk"),
          fontSize: 14,
          lineHeight: 1.36,
          textAlign: "center",
          padding: "8px 16px 11px",
          borderRadius: 8,
          maxWidth: "100%",
          fontFamily: cssVar("fontText"),
        }}
      >
        {sentence.words.map((word, index) => {
          const isActive = index === activeWord;
          return (
            <span
              key={`${shownIndex}-${index}`}
              style={{
                color: cssVar("photoInk"),
                fontWeight: 400,
                boxShadow: isActive
                  ? "inset 0 -0.44em 0 rgba(255,255,255,0.34)"
                  : "inset 0 -0.44em 0 rgba(255,255,255,0)",
                borderRadius: 2,
              }}
            >
              {word.text}
              {index < sentence.words.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function IdleSlate({ concept }: { concept: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "0 28px",
        background: cssVar("bg"),
      }}
    >
      <div
        style={{
          fontFamily: cssVar("fontMono"),
          fontSize: 11,
          letterSpacing: ".2em",
          textTransform: "uppercase",
          color: cssVar("dim"),
        }}
      >
        {concept.replace(/-/g, " ")}
      </div>
      <div style={{ width: 44, height: 3, background: cssVar("accent"), marginTop: 16 }} />
    </div>
  );
}

const AVATAR_OVERLAY_VIDEO_CSS = `
  [data-ciq-avatar-overlay-card] {
    background: transparent !important;
  }
  [data-ciq-avatar-overlay-card] > img,
  [data-ciq-avatar-overlay-card] > [data-ciq-image-placeholder],
  [data-ciq-avatar-overlay-card] > [data-ciq-video] {
    display: none !important;
  }
`;

export function UnitContentComposition(props: UnitContentCompositionProps) {
  const frame = useCurrentFrame();
  const video = useVideoConfig();
  const clockMs = Math.floor((frame / video.fps) * 1000);
  const active = deriveActiveCard(props.timing, clockMs, { reducedMotion: false });
  const card =
    active.cardIndex === null ? null : props.unit.content.cards[active.cardIndex] ?? null;
  const isAvatarOverlay = card?.visualTreatment === "avatar-overlay";
  const stageScale = video.width / STAGE_WIDTH;
  const stageHeight = video.height / stageScale;
  const theme = brandThemeFromTokens(props.themeTokens);
  const visualAssetUrls = visualAssetUrlsForUnit({
    unit: props.unit,
    assetUrls: props.assetUrls,
    institutionLogoUrl: props.institutionLogoUrl,
  });

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {props.avatarVideoUrl ? (
        <OffthreadVideo
          src={props.avatarVideoUrl}
          muted
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : null}
      <AssetResolverContext.Provider
        value={{ resolve: (ref) => props.assetUrls[ref] ?? null }}
      >
        <MediaModeProvider value="static">
          <BrandThemeProvider theme={theme}>
            <RemotionBrandFontLoader
              fontFamily={fontFamilyFromThemeTokens(props.themeTokens)}
              fontFamilies={[theme.fontDisplay, theme.fontText, theme.fontMono]}
            />
            <RemotionVisualAssetPreloader urls={visualAssetUrls} />
            <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: STAGE_WIDTH,
                  height: stageHeight,
                  transform: `scale(${stageScale})`,
                  transformOrigin: "top left",
                  overflow: "hidden",
                  background: isAvatarOverlay ? "transparent" : cssVar("bg"),
                }}
              >
                {card ? (
                  isAvatarOverlay ? (
                    <>
                      <style>{AVATAR_OVERLAY_VIDEO_CSS}</style>
                      <AvatarOverlayCard
                        template={card.template}
                        props={withInstitutionLogo(
                          card.template,
                          card.props,
                          props.institutionLogoUrl
                        )}
                        timing={active.timing}
                      />
                    </>
                  ) : (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: cssVar("bg"),
                      }}
                    >
                      <CardRenderer
                        template={card.template}
                        props={withInstitutionLogo(
                          card.template,
                          card.props,
                          props.institutionLogoUrl
                        )}
                        timing={active.timing}
                      />
                    </div>
                  )
                ) : (
                  <IdleSlate concept={props.unit.concept} />
                )}
                <CaptionOverlay timing={props.timing} clockMs={clockMs} />
              </div>
            </div>
          </BrandThemeProvider>
        </MediaModeProvider>
      </AssetResolverContext.Provider>

      <Audio src={props.unitAudioUrl} />
    </AbsoluteFill>
  );
}
