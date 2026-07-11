export { SETTLED_TIMING, type CardTiming, type CardComponentProps } from "./src/timing";
export {
  interpolate,
  linear,
  easeOut,
  easeOutBack,
  msWindow,
  beatProgress,
  fade,
  fadeUp,
  settle,
  pop,
  growX,
  growY,
  pan,
  type Easing,
  type InterpolateOptions,
  type PanDirection,
} from "./src/interpolate";
export {
  BEAT_BASE_MS,
  BEAT_STAGGER_MS,
  beatsRevealedAt,
  clampClock,
  deriveActiveCard,
  deriveActiveSentence,
  type ActiveCard,
  type ActiveSentence,
} from "./src/timeline";
export {
  counseliqTheme,
  latrobeTheme,
  brandThemeFromTokens,
  type BrandTheme,
} from "./src/theme/brand-theme";
export {
  BrandThemeProvider,
  useBrandTheme,
  cssVar,
  themeToCssProperties,
  type BrandThemeProviderProps,
} from "./src/theme/brand-theme-provider";
export {
  CardStage,
  STAGE_WIDTH,
  STAGE_HEIGHT,
  CAPTION_SAFE_HEIGHT,
  type CardStageProps,
} from "./src/card-stage";
export { CardRenderer, type CardRendererProps } from "./src/card-renderer";
export { FallbackCard, type FallbackCardProps } from "./src/fallback-card";
export { TEMPLATE_COMPONENTS } from "./src/templates/registry";
export {
  AssetResolverContext,
  useAssetResolver,
  CardImage,
  type AssetResolver,
  type CardImageProps,
} from "./src/assets";
export { CardVideo, type CardVideoProps } from "./src/card-video";
export {
  MediaModeProvider,
  useMediaMode,
  type MediaMode,
} from "./src/media-mode";
