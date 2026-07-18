export {
  CARD_TEMPLATES,
  CourseDefinitionParseError,
  anchorSchema,
  assessmentSchema,
  cardSchema,
  cardTemplateSchema,
  courseDefinitionSchema,
  enterAtSchema,
  hookSchema,
  microUnitSchema,
  moduleSchema,
  narrationSentenceSchema,
  parseCourseDefinition,
  pipelineNotesSchema,
  questionBankItemSchema,
  voiceSchema,
} from "./src/course-definition";

export type {
  Card,
  CardTemplate,
  CourseAssessment,
  CourseDefinition,
  CourseModule,
  CourseVoice,
  MicroUnit,
  NarrationSentence,
  PipelineNotes,
  QuestionBankItem,
} from "./src/course-definition";

export {
  AVATAR_OVERLAY_TEMPLATES,
  avatarLookAssignmentSchema,
  avatarLookEvaluationSchema,
  avatarLookSchema,
  coursePresentationSchema,
  supportsAvatarOverlay,
  visualTreatmentSchema,
} from "./src/presentation";

export type {
  AvatarLook,
  AvatarLookAssignment,
  AvatarLookEvaluation,
  CoursePresentation,
  VisualTreatment,
} from "./src/presentation";

export {
  CARD_PROP_SCHEMAS,
  typedCardContentSchema,
  validateCardProps,
} from "./src/card-props";

export type { CardPropsFor, TypedCardContent } from "./src/card-props";

export { CARD_PROP_FIXTURES } from "./src/card-props-fixtures";

export {
  FINAL_CONTENT_HOLD_MS,
  TIMING_VERSION,
  audioEndMsForSentences,
  cardBeatSchema,
  contentEndMsForTiming,
  mediaWindowSchema,
  scriptAlignmentSegmentSchema,
  scriptSentenceSchema,
  timingSentenceSchema,
  timingWordSchema,
  unitScriptSchema,
  unitTimingSchema,
} from "./src/timing";

export type {
  CardBeat,
  MediaWindow,
  ScriptAlignmentSegment,
  ScriptSentence,
  TimingSentence,
  TimingWord,
  UnitScript,
  UnitTiming,
} from "./src/timing";

export {
  ASSET_ASPECTS,
  ASSET_ORIGINS,
  ASSET_RIGHTS,
  ASSET_SUGGESTED_USES,
  MEDIA_ASSET_KINDS,
  assetAspectSchema,
  assetOriginSchema,
  assetRecordSchema,
  assetRightsSchema,
  assetSuggestedUseSchema,
  compactCatalogueAssetSchema,
  deriveAspect,
  mediaAssetKindSchema,
} from "./src/assets";

export type {
  AssetAspect,
  AssetOrigin,
  AssetRecord,
  AssetRights,
  AssetSuggestedUse,
  CompactCatalogueAsset,
  MediaAssetKind,
} from "./src/assets";

export {
  PUBLISH_MANIFEST_SCHEMA_REF,
  PublishManifestParseError,
  manifestAssetSchema,
  manifestAudioSentenceSchema,
  manifestUnitSchema,
  parsePublishManifest,
  publishManifestSchema,
} from "./src/publish-manifest";

export type {
  ManifestAsset,
  ManifestAudioSentence,
  ManifestUnit,
  PublishManifest,
} from "./src/publish-manifest";

export {
  OBJECT_KEY_PATTERN,
  assetIngestCallbackSchema,
  assetIngestFileSchema,
  assetIngestManifestSchema,
  assetIngestRequestSchema,
  assetManifestEntrySchema,
  contentAddressedKeySchema,
  conversionCallbackSchema,
  conversionManifestSchema,
  convertRequestSchema,
  embeddedImageSchema,
  manifestPageSchema,
  pdfExtractedImageSchema,
  pdfImageExtractRequestSchema,
  pdfImageManifestSchema,
  pdfImagesCallbackSchema,
  sourceDocKindSchema,
} from "./src/ingestion";

export type {
  AssetIngestCallback,
  AssetIngestFile,
  AssetIngestManifest,
  AssetIngestRequest,
  AssetManifestEntry,
  ConversionCallback,
  ConversionManifest,
  ConvertRequest,
  EmbeddedImage,
  ManifestPage,
  PdfExtractedImage,
  PdfImageExtractRequest,
  PdfImageManifest,
  PdfImagesCallback,
  SourceDocKind,
} from "./src/ingestion";

export {
  FLAG_REASON_MISSING_SOURCE_OR_YEAR,
  PROVENANCE_ID_PATTERN,
  applyFlagFloor,
  claimClassSchema,
  conceptSchema,
  entityKindSchema,
  entitySchema,
  factSchema,
  inventoryItemSchema,
  knownDirtyStatisticSchema,
  labelledConceptSchema,
  labelsFileSchema,
  llmExtractedConceptSchema,
  llmExtractedEntitySchema,
  llmExtractedFactSchema,
  llmExtractedQuoteSchema,
  llmMergeResultSchema,
  llmMergedConceptSchema,
  llmPageExtractionSchema,
  mustExtractEntitySchema,
  normalizeConceptTitle,
  provenanceIdSchema,
  quoteSchema,
} from "./src/inventory";

export type {
  ClaimClass,
  Concept,
  Entity,
  EntityKind,
  Fact,
  InventoryItem,
  KnownDirtyStatistic,
  LabelledConcept,
  LabelsFile,
  LlmMergeResult,
  LlmPageExtraction,
  Quote,
} from "./src/inventory";

export {
  renderAvatarTrackSchema,
  renderCallbackSchema,
  renderFailurePayloadSchema,
  renderJobRequestSchema,
  renderOutputVariantSchema,
  renderProfileSchema,
  renderSuccessPayloadSchema,
  renderVariantProfileSchema,
} from "./src/render";

export type {
  RenderAvatarTrack,
  RenderCallback,
  RenderFailurePayload,
  RenderJobRequest,
  RenderOutputVariant,
  RenderProfile,
  RenderSuccessPayload,
  RenderVariantProfile,
} from "./src/render";
