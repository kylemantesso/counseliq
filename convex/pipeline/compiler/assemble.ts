import type {
  CompactCatalogueAsset,
  Concept,
  CourseDefinition,
  Fact,
  MicroUnit,
  QuestionBankItem,
} from "@counseliq/course-schema";
import {
  CourseDefinitionParseError,
  parseCourseDefinition,
} from "@counseliq/course-schema";
import type { LlmAuthoredUnit, LlmDraftQuestion } from "./schemas";
import {
  DERIVED_PROVENANCE,
  cardText,
  findBannedClaimsInText,
  findRedundantCards,
  longestFragmentTokens,
  textHasAttribution,
  textHasNegation,
  validateAssetRefs,
  validateCardProvenance,
  validateGenericCardCap,
  validateMediaPacing,
  validateQuestionConceptTags,
  validateStatisticCardsHaveSource,
  validateUniqueQuestionPrompts,
  type CatalogueAssetInfo,
  type MediaAvailability,
} from "./rules";

/**
 * Pure assembly + compliance logic for the M4 compiler: prompt input
 * builders, per-unit and course-level code-enforced checks, and the
 * CourseDefinition assembly. No Convex, no LLM, no node built-ins — fully
 * unit-testable. The orchestration lives in compile.ts ("use node").
 */

export const UNIT_RANGE_DEFAULT: [number, number] = [8, 12];
export const MODULE_RANGE_DEFAULT: [number, number] = [3, 5];

/** "8-12" → [8, 12]; anything malformed falls back. */
export function parseRange(
  raw: string | undefined,
  fallback: [number, number]
): [number, number] {
  const match = raw?.match(/^(\d+)-(\d+)$/);
  if (!match) return fallback;
  const low = Number(match[1]);
  const high = Number(match[2]);
  if (low < 1 || high < low) return fallback;
  return [low, high];
}

export interface UnitPlan {
  unitId: string;
  conceptKey: string;
  conceptTag: string;
  title: string;
  secondsBudget: number;
  moduleId: string;
  moduleTitle: string;
  /** Outline-suggested cleared asset ids (bias, not commitment — M6.5). */
  mediaAssetIds?: string[];
}

export interface AuthoredUnitWithPlan {
  plan: UnitPlan;
  authored: LlmAuthoredUnit;
  /** Non-blocking code-rule violations, surfaced at gate 2 (M6.5). */
  complianceWarnings?: string[];
}

export interface ReviewedInventory {
  institution: {
    name: string;
    market: string;
    pronunciationLexicon: unknown;
  };
  concepts: Concept[];
  facts: Fact[];
  excludedFacts: Fact[];
  provenanceIds: string[];
  /** M6.5: operator brief (null when the run has none). */
  brief?: string | null;
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function moduleKicker(moduleId: string): string | null {
  const match = moduleId.match(/^m(\d+)(?:-|$)/i);
  if (!match) return null;
  return `MODULE ${match[1]}`;
}

function firstWord(text: string): string {
  const match = text.match(/\S+/);
  return match?.[0] ?? text;
}

function alignedAnchorWord(sentenceText: string, desiredWord: string): string {
  if (sentenceText.includes(desiredWord)) {
    return desiredWord;
  }

  const loweredText = sentenceText.toLowerCase();
  const loweredDesired = desiredWord.toLowerCase();
  if (loweredDesired.length > 0) {
    const matchIndex = loweredText.indexOf(loweredDesired);
    if (matchIndex >= 0) {
      return sentenceText.slice(matchIndex, matchIndex + desiredWord.length);
    }
  }

  return firstWord(sentenceText);
}

/**
 * Canonicalize the opener so every generated unit starts with a title-card
 * anchored to the very first spoken word.
 */
export function normalizeOpeningTitleCard(
  authored: LlmAuthoredUnit,
  context: {
    unitTitle: string;
    moduleId: string;
    institutionName: string;
    courseTitle: string;
  }
): LlmAuthoredUnit {
  const firstSentence = authored.narration[0];
  if (!firstSentence) return authored;

  const existingIndex = authored.cards.findIndex(
    (card) => card.template === "title-card"
  );
  const existing = existingIndex >= 0 ? authored.cards[existingIndex] : null;
  const existingProps = (existing?.props ?? {}) as Record<string, unknown>;

  const title = nonEmptyText(existingProps.title) ?? context.unitTitle;
  const kicker =
    nonEmptyText(existingProps.kicker) ??
    moduleKicker(context.moduleId) ??
    context.institutionName;
  const courseLabel =
    nonEmptyText(existingProps.courseLabel) ?? context.courseTitle;

  const normalizedProps: Record<string, unknown> = {
    ...existingProps,
    title,
    ...(kicker ? { kicker } : {}),
    ...(courseLabel ? { courseLabel } : {}),
  };

  const opening = {
    template: "title-card" as const,
    props: normalizedProps,
    enterAt: {
      narration: firstSentence.id,
      word: firstWord(firstSentence.text),
    },
    provenance: DERIVED_PROVENANCE,
  };

  return {
    ...authored,
    cards: [
      opening,
      ...authored.cards.filter((_, index) => index !== existingIndex),
    ],
  };
}

/**
 * Best-effort enterAt repair: keeps card timing anchors valid for playback
 * and schema validation when the author model emits a drifted anchor word.
 * Repairs are surfaced as non-blocking warnings.
 */
export function normalizeCardEnterAtAnchors(authored: LlmAuthoredUnit): {
  authored: LlmAuthoredUnit;
  warnings: string[];
} {
  const firstSentence = authored.narration[0];
  if (!firstSentence) {
    return { authored, warnings: [] };
  }

  const narrationById = new Map(
    authored.narration.map((sentence) => [sentence.id, sentence.text] as const)
  );
  const warnings: string[] = [];

  const cards = authored.cards.map((card, index) => {
    const originalNarration = card.enterAt.narration;
    const originalWord = card.enterAt.word;

    let narrationId = originalNarration;
    let sentenceText = narrationById.get(narrationId);
    let narrationAdjusted = false;

    if (sentenceText === undefined) {
      narrationId = firstSentence.id;
      sentenceText = firstSentence.text;
      narrationAdjusted = true;
    }

    const nextWord = alignedAnchorWord(sentenceText, originalWord);
    const wordAdjusted = nextWord !== originalWord;

    if (narrationAdjusted || wordAdjusted) {
      const parts = [] as string[];
      if (narrationAdjusted) {
        parts.push(`narration \"${originalNarration}\" not found; using \"${narrationId}\"`);
      }
      if (wordAdjusted) {
        parts.push(
          `word \"${originalWord}\" not found in narration \"${narrationId}\"; using \"${nextWord}\"`
        );
      }
      warnings.push(
        `card ${index + 1} (${card.template}) timing anchor repaired: ${parts.join("; ")}`
      );
    }

    return {
      ...card,
      enterAt: {
        narration: narrationId,
        word: nextWord,
      },
    };
  });

  return {
    authored: {
      ...authored,
      cards,
    },
    warnings,
  };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// --- Prompt user-content builders ---

export function factForPrompt(fact: Fact) {
  return {
    statement: fact.statement,
    claimClass: fact.claimClass,
    sourceLabel: fact.sourceLabel ?? null,
    year: fact.year ?? null,
    provenance: fact.provenance,
  };
}

export function buildStructureUserText(
  inventory: ReviewedInventory,
  unitRange: [number, number],
  moduleRange: [number, number]
): string {
  const factsByConcept = new Map<string, Fact[]>();
  for (const fact of inventory.facts) {
    const list = factsByConcept.get(fact.conceptKey) ?? [];
    list.push(fact);
    factsByConcept.set(fact.conceptKey, list);
  }
  const conceptListing = inventory.concepts.map((concept) => ({
    conceptKey: concept.key,
    title: concept.title,
    summary: concept.summary,
    approvedFactCount: (factsByConcept.get(concept.key) ?? []).length,
    facts: (factsByConcept.get(concept.key) ?? []).map(factForPrompt),
  }));
  return [
    `Course parameters:`,
    `- institution: ${inventory.institution.name} (market: ${inventory.institution.market})`,
    `- target: ${unitRange[0]}-${unitRange[1]} micro-units across ${moduleRange[0]}-${moduleRange[1]} modules`,
    `- audience: education counsellors being credentialed on this institution`,
    ``,
    `Reviewed knowledge inventory (concepts with their approved facts):`,
    JSON.stringify(conceptListing, null, 2),
  ].join("\n");
}

/** Prompt-size cap for the outline pass's cleared-asset summary. */
export const OUTLINE_ASSET_SUMMARY_CAP = 100;

/**
 * User text for the outline pass (M6.5): the structure-pass input enriched
 * with the operator brief (which rules concept selection), a cleared-asset
 * summary (media-aware concept preference + per-unit mediaAssetIds
 * suggestions), and any regenerate feedback from the review step.
 */
export function buildOutlineUserText(
  inventory: ReviewedInventory,
  unitRange: [number, number],
  moduleRange: [number, number],
  brief: string | undefined,
  catalogue: readonly CompactCatalogueAsset[],
  regenFeedback: readonly string[] = []
): string {
  const parts = [buildStructureUserText(inventory, unitRange, moduleRange)];
  if (brief !== undefined && brief.trim() !== "") {
    parts.push(
      ``,
      `OPERATOR BRIEF (the course's intended purpose — this rules concept selection and the learning outcomes):`,
      brief.trim()
    );
  }
  if (catalogue.length > 0) {
    const summary = catalogue.slice(0, OUTLINE_ASSET_SUMMARY_CAP);
    parts.push(
      ``,
      `Cleared media library (${summary.length} asset(s); suggest per-unit mediaAssetIds ONLY from these ids, only where the caption fits the concept):`,
      ...summary.map((asset) =>
        JSON.stringify({
          id: asset.id,
          kind: asset.kind,
          caption: asset.caption,
          tags: asset.tags,
          ...(asset.deckPage !== undefined ? { deckPage: asset.deckPage } : {}),
        })
      )
    );
  } else {
    parts.push(
      ``,
      `No cleared media assets are available — set mediaAssetIds to null everywhere.`
    );
  }
  if (regenFeedback.length > 0) {
    parts.push(
      ``,
      `The operator reviewed previous outline attempt(s) and asked for changes — follow ALL of these:`,
      ...regenFeedback.map((note, index) => `${index + 1}. ${note}`)
    );
  }
  return parts.join("\n");
}

/**
 * The approved outline mapped into the compiler's in-memory planning shape
 * (M6.5) — the exact mapping the inline structure pass used to produce,
 * plus the outline's per-unit media suggestions.
 */
export function plansFromOutline(outline: {
  courseTitle: string;
  modules: Array<{
    moduleId: string;
    title: string;
    units: Array<{
      unitId: string;
      conceptKey: string;
      conceptTag: string;
      title: string;
      secondsBudget: number;
      mediaAssetIds?: string[] | null;
    }>;
  }>;
}): {
  courseTitle: string;
  moduleOrder: Array<{ moduleId: string; title: string }>;
  plans: UnitPlan[];
} {
  return {
    courseTitle: outline.courseTitle,
    moduleOrder: outline.modules.map((m) => ({
      moduleId: m.moduleId,
      title: m.title,
    })),
    plans: outline.modules.flatMap((module) =>
      module.units.map((unit) => ({
        unitId: unit.unitId,
        conceptKey: unit.conceptKey,
        conceptTag: unit.conceptTag,
        title: unit.title,
        secondsBudget: unit.secondsBudget,
        moduleId: module.moduleId,
        moduleTitle: module.title,
        ...(unit.mediaAssetIds && unit.mediaAssetIds.length > 0
          ? { mediaAssetIds: unit.mediaAssetIds }
          : {}),
      }))
    ),
  };
}

/**
 * Media context for authoring + validation, built ONLY from cleared assets
 * (getClearedCatalogueForRun filters in code — the model and these
 * validators never see an unknown-rights asset except as "missing").
 */
export interface UnitMediaContext {
  catalogueById: ReadonlyMap<string, CatalogueAssetInfo>;
  availability: MediaAvailability;
}

/** Derive the validation context from the compact prompt catalogue. */
export function mediaContextFromCatalogue(
  catalogue: readonly CompactCatalogueAsset[]
): UnitMediaContext {
  return {
    catalogueById: new Map(
      catalogue.map((asset) => [
        asset.id,
        { kind: asset.kind, aspect: asset.aspect, cleared: true },
      ])
    ),
    availability: {
      images: catalogue.filter((asset) => asset.kind === "image").length,
      videos: catalogue.filter((asset) => asset.kind === "video").length,
    },
  };
}

export function buildUnitUserText(
  plan: UnitPlan,
  concept: Concept | undefined,
  facts: Fact[],
  courseTitle: string,
  institutionName: string,
  lexiconNames: string[],
  catalogue: readonly CompactCatalogueAsset[],
  brief?: string,
  feedback?: string
): string {
  const parts = [
    `Course: ${courseTitle} (institution: ${institutionName})`,
    `Module: ${plan.moduleTitle} (${plan.moduleId})`,
    `Unit: ${plan.title} (unitId: ${plan.unitId})`,
    `Concept tag: ${plan.conceptTag}`,
    `Seconds budget: ${plan.secondsBudget}`,
    ``,
    `The unit's concept:`,
    JSON.stringify(
      concept
        ? { key: concept.key, title: concept.title, summary: concept.summary }
        : { key: plan.conceptKey, title: plan.title },
      null,
      2
    ),
    ``,
    `Approved facts for this concept (the ONLY factual claims you may narrate):`,
    JSON.stringify(facts.map(factForPrompt), null, 2),
  ];
  if (brief !== undefined && brief.trim() !== "") {
    parts.push(
      ``,
      `Course purpose (operator brief — keep the unit aligned with it):`,
      brief.trim()
    );
  }
  if (lexiconNames.length > 0) {
    parts.push(
      ``,
      `Names with pronunciation-lexicon entries (use exactly as spelled): ${lexiconNames.join(", ")}`
    );
  }
  if (catalogue.length > 0) {
    parts.push(
      ``,
      `Cleared asset library (reference by asset id EXACTLY as listed; never invent ids. "assetRef" is for media cards: video-card needs a video, photo-kenburns/image-text-card need an image. "bgAssetRef" is for subtle image backgrounds on stat-card/list-reveal/takeaway-card):`,
      ...catalogue.map((asset) => JSON.stringify(asset))
    );
  } else {
    parts.push(
      ``,
      `No cleared media assets are available for this institution — do not emit video-card/photo-kenburns/image-text-card cards, and do not put assetRef/bgAssetRef on any card.`
    );
  }
  if (plan.mediaAssetIds && plan.mediaAssetIds.length > 0) {
    parts.push(
      ``,
      `Outline-suggested assets for THIS unit (prefer these where they fit; other library assets remain allowed): ${plan.mediaAssetIds.join(", ")}`
    );
  }
  if (feedback) {
    parts.push(
      ``,
      `A previous draft of this unit violated these rules — fix ALL of them:`,
      feedback
    );
  }
  return parts.join("\n");
}

// --- Code-enforced compliance (per unit, post-parse) ---

/**
 * Fail-open policy (operator decision): compliance violations get ONE
 * authoring retry, then the unit is ACCEPTED with the remaining
 * violations attached as warnings for gate-2 review.
 *
 * Most issues stay warning-only. Source-authenticity violations are
 * blocking: generated source-ish labels must match approved fact sources.
 */
export function partitionComplianceViolations(violations: string[]): {
  blocking: string[];
  warnings: string[];
} {
  const blocking = violations.filter((violation) =>
    violation.startsWith("source-authenticity:")
  );
  const warnings = violations.filter(
    (violation) => !violation.startsWith("source-authenticity:")
  );
  return { blocking, warnings };
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function collectStringPropsByKey(
  value: unknown,
  key: string,
  out: string[] = []
): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectStringPropsByKey(entry, key, out);
    return out;
  }
  if (value === null || typeof value !== "object") return out;
  for (const [entryKey, entryValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (entryKey === key && typeof entryValue === "string") {
      const trimmed = entryValue.trim();
      if (trimmed.length > 0) out.push(trimmed);
      continue;
    }
    collectStringPropsByKey(entryValue, key, out);
  }
  return out;
}

const CLAIM_MARKER_KEYS = ["kicker", "subtitle", "eyebrow"] as const;
const CLAIM_WORD_PATTERN = /\bclaims?\b/i;

export function unitComplianceViolations(
  authored: LlmAuthoredUnit,
  knownProvenanceIds: ReadonlySet<string>,
  media: UnitMediaContext,
  approvedSourceLabels?: ReadonlySet<string>
): string[] {
  const violations: string[] = [];
  const approvedSourceLabelsNormalized =
    approvedSourceLabels === undefined
      ? null
      : new Set(
          [...approvedSourceLabels]
            .map(normalizeLabel)
            .filter((label) => label.length > 0)
        );
  const narrationById = new Map(
    authored.narration.map((sentence) => [sentence.id, sentence.text])
  );
  const narrationIndexById = new Map(
    authored.narration.map((sentence, index) => [sentence.id, index] as const)
  );
  const firstSentence = authored.narration[0];

  const DISPLAY_TEXT_WARNING_CAPS: Partial<
    Record<string, Record<string, number>>
  > = {
    "text-card": { body: 200 },
    "alert-card": { message: 180 },
    "quote-card": { quote: 220 },
    "myth-fact-card": { myth: 140, fact: 140 },
    "photo-kenburns": { overlayText: 120 },
    "takeaway-card": { text: 160 },
    "video-card": { overlayText: 120 },
  };

  const checkDisplayCaps = (
    template: string,
    props: Record<string, unknown>,
    label: string
  ) => {
    const caps = DISPLAY_TEXT_WARNING_CAPS[template];
    if (!caps) return;
    for (const [prop, max] of Object.entries(caps)) {
      const value = props[prop];
      if (typeof value === "string" && value.length > max) {
        violations.push(
          `${label} ${template} ${prop} is ${value.length} characters; recommended max is ${max} for readability`
        );
      }
    }
  };

  // A card whose props carry a non-empty sourceLabel is attributed — the
  // label IS the attribution for any superlative on the card (per the
  // authoring rules). Promises (visa/PR/employment) stay banned everywhere.
  const hasSourceLabel = (props: Record<string, unknown>): boolean =>
    typeof props.sourceLabel === "string" && props.sourceLabel.trim() !== "";
  const checkBlob = (
    blob: string,
    context: { attributed: boolean; debunking: boolean }
  ) => {
    for (const hit of findBannedClaimsInText(blob)) {
      if (context.attributed && hit.code === "unattributed-superlative") {
        continue;
      }
      if (
        context.debunking &&
        (hit.code === "migration-outcome-promise" ||
          hit.code === "employment-guarantee")
      ) {
        continue;
      }
      violations.push(
        `banned claim (${hit.code}): "${hit.excerpt}" — ${hit.description}`
      );
    }
  };

  // Narration is judged sentence by sentence with no blanket context.
  for (const sentence of authored.narration) {
    checkBlob(sentence.text, { attributed: false, debunking: false });
  }
  // A card is one claim context: a myth-fact/alert card that names the
  // banned promise while debunking it is legal; a sourceLabel attributes
  // any superlative on the card.
  for (const card of [
    ...authored.cards,
    { template: authored.anchor.template, props: authored.anchor.props },
  ]) {
    const blob = cardText(card.props);
    checkBlob(blob, {
      attributed: hasSourceLabel(card.props),
      debunking: textHasNegation(blob),
    });
  }

  authored.cards.forEach((card, index) => {
    const cardProps = card.props as Record<string, unknown>;
    const sentence = narrationById.get(card.enterAt.narration);
    if (sentence !== undefined && !sentence.includes(card.enterAt.word)) {
      violations.push(
        `card ${index + 1} enterAt.word "${card.enterAt.word}" is not present in narration sentence "${card.enterAt.narration}"`
      );
    }
    checkDisplayCaps(card.template, cardProps, `card ${index + 1}`);

    for (const sourceLabel of collectStringPropsByKey(cardProps, "sourceLabel")) {
      if (
        approvedSourceLabelsNormalized !== null &&
        !approvedSourceLabelsNormalized.has(normalizeLabel(sourceLabel))
      ) {
        violations.push(
          `source-authenticity: card ${index + 1} (${card.template}) uses sourceLabel "${sourceLabel}" not present in this unit's approved fact sources`
        );
      }
    }

    for (const markerKey of CLAIM_MARKER_KEYS) {
      const value = cardProps[markerKey];
      if (typeof value !== "string") continue;
      const marker = value.trim();
      if (marker.length === 0 || !CLAIM_WORD_PATTERN.test(marker)) continue;
      if (
        approvedSourceLabelsNormalized !== null &&
        !approvedSourceLabelsNormalized.has(normalizeLabel(marker))
      ) {
        violations.push(
          `source-authenticity: card ${index + 1} (${card.template}) uses ${markerKey} "${marker}" without a matching approved source label`
        );
      }
    }
  });

  // Visual pacing guidance (warning-only): keep the opener brief and refresh
  // cards frequently enough that visuals track narration instead of lingering.
  const recommendedCardFloor =
    authored.narration.length >= 5
      ? 4
      : authored.narration.length >= 3
        ? 3
        : 2;
  if (authored.cards.length < recommendedCardFloor) {
    violations.push(
      `card pacing: ${authored.cards.length} card(s) for ${authored.narration.length} narration sentence(s) — add at least ${recommendedCardFloor} cards so visuals refresh more frequently`
    );
  }

  const openingCard = authored.cards[0];
  const secondSentence = authored.narration[1];
  if (
    firstSentence &&
    secondSentence &&
    openingCard?.template === "title-card" &&
    authored.cards.length > 1
  ) {
    const firstContentCard = authored.cards.find(
      (card, index) => index > 0 && card.template !== "title-card"
    );
    if (firstContentCard) {
      if (firstContentCard.enterAt.narration !== secondSentence.id) {
        violations.push(
          `title-card pacing: first content card (${firstContentCard.template}) anchors to "${firstContentCard.enterAt.narration}" — anchor it to "${secondSentence.id}" so the title-card covers only sentence 1`
        );
      } else {
        const secondSentenceOpeningWord = firstWord(secondSentence.text);
        const secondSentenceFirstWord = secondSentenceOpeningWord.toLowerCase();
        if (
          secondSentenceFirstWord.length > 0 &&
          firstContentCard.enterAt.word.toLowerCase() !== secondSentenceFirstWord
        ) {
          violations.push(
            `title-card pacing: first content card (${firstContentCard.template}) uses enterAt.word "${firstContentCard.enterAt.word}" — use the first spoken word "${secondSentenceOpeningWord}" in "${secondSentence.id}" for a clean sentence-boundary handoff`
          );
        }
      }
    }
  }

  for (let i = 1; i < authored.cards.length; i++) {
    const previous = authored.cards[i - 1];
    const current = authored.cards[i];
    const previousIndex = narrationIndexById.get(previous.enterAt.narration);
    const currentIndex = narrationIndexById.get(current.enterAt.narration);
    if (
      previousIndex !== undefined &&
      currentIndex !== undefined &&
      currentIndex - previousIndex > 1
    ) {
      violations.push(
        `card pacing: cards ${i} and ${i + 1} skip ${currentIndex - previousIndex - 1} narration sentence(s) (${previous.enterAt.narration} -> ${current.enterAt.narration}) — add an intermediate card anchor so visuals do not linger`
      );
      break;
    }
  }

  checkDisplayCaps(
    authored.anchor.template,
    authored.anchor.props as Record<string, unknown>,
    "anchor"
  );
  const anchorProps = authored.anchor.props as Record<string, unknown>;
  for (const sourceLabel of collectStringPropsByKey(anchorProps, "sourceLabel")) {
    if (
      approvedSourceLabelsNormalized !== null &&
      !approvedSourceLabelsNormalized.has(normalizeLabel(sourceLabel))
    ) {
      violations.push(
        `source-authenticity: anchor (${authored.anchor.template}) uses sourceLabel "${sourceLabel}" not present in this unit's approved fact sources`
      );
    }
  }
  for (const markerKey of CLAIM_MARKER_KEYS) {
    const value = anchorProps[markerKey];
    if (typeof value !== "string") continue;
    const marker = value.trim();
    if (marker.length === 0 || !CLAIM_WORD_PATTERN.test(marker)) continue;
    if (
      approvedSourceLabelsNormalized !== null &&
      !approvedSourceLabelsNormalized.has(normalizeLabel(marker))
    ) {
      violations.push(
        `source-authenticity: anchor (${authored.anchor.template}) uses ${markerKey} "${marker}" without a matching approved source label`
      );
    }
  }
  // A question is one claim context: attribution in its prompt/explanation
  // covers superlatives quoted in its options, and a negation anywhere
  // covers promise phrases the question is debunking.
  for (const question of [authored.hookQuestion, ...authored.retrieveQuestions]) {
    const joined = [
      question.prompt,
      ...question.options,
      question.explanation,
    ].join(" ");
    checkBlob(joined, {
      attributed: textHasAttribution(joined),
      debunking: textHasNegation(joined),
    });
  }

  violations.push(...validateGenericCardCap(authored.cards));
  violations.push(
    ...validateCardProvenance(authored.cards, knownProvenanceIds)
  );
  violations.push(...validateStatisticCardsHaveSource(authored.cards));
  // Media refs on the anchor are validated too (an anchor card can carry
  // an assetRef); pacing applies to the content cards only.
  violations.push(
    ...validateAssetRefs(
      [
        ...authored.cards,
        { template: authored.anchor.template, props: authored.anchor.props },
      ],
      media.catalogueById
    )
  );
  violations.push(...validateMediaPacing(authored.cards, media.availability));

  // Mayer's redundancy principle, enforced in code for the egregious case:
  // a card that is a (near-)transcript of its narration sentence is
  // rejected outright. Transcription requires BOTH directions: the card's
  // tokens come from the sentence (overlap) AND the card reproduces most of
  // the sentence (coverage). A compressed extract — a few keywords/numbers
  // pulled from the narration, exactly what the prompt asks for — has high
  // overlap but low coverage and must NOT be rejected. Lower-grade
  // redundancy is left to the judge as gate-2 review material.
  for (const candidate of findRedundantCards({
    unitId: "unit",
    narration: authored.narration,
    cards: authored.cards,
  })) {
    if (candidate.overlap < TRANSCRIPT_OVERLAP_THRESHOLD) continue;
    if (candidate.coverage < TRANSCRIPT_COVERAGE_THRESHOLD) continue;
    const card = authored.cards[candidate.cardIndex];
    // A card built entirely from short label fragments (e.g. a list-reveal
    // mirroring an enumeration sentence) is the intended signaling pattern,
    // not prose transcription — leave it to the judge as review material.
    if (longestFragmentTokens(card.props) <= LABEL_FRAGMENT_MAX_TOKENS) {
      continue;
    }
    const sentence = narrationById.get(card.enterAt.narration) ?? "";
    violations.push(
      `card ${candidate.cardIndex + 1} (${candidate.template}) is a transcript of its narration sentence "${sentence.slice(0, 120)}" (${Math.round(candidate.overlap * 100)}% overlap, ${Math.round(candidate.coverage * 100)}% coverage) — put a short compressed fragment on the card (a number, a 2-4 word label), not the sentence itself`
    );
  }

  return violations;
}

/** Overlap at which a card counts as a narration transcript (hard reject). */
export const TRANSCRIPT_OVERLAP_THRESHOLD = 0.9;

/**
 * Coverage floor for the hard reject: the card must also reproduce at least
 * this share of the sentence's distinct tokens to count as a transcript.
 */
export const TRANSCRIPT_COVERAGE_THRESHOLD = 0.7;

/**
 * Cards whose longest text fragment is at most this many content tokens are
 * label-built (list items, chips) and exempt from the transcript hard
 * reject; the judge still reviews them for redundancy.
 */
export const LABEL_FRAGMENT_MAX_TOKENS = 6;

// --- Assembly ---

function toQuestionBankItem(
  question: LlmDraftQuestion,
  id: string,
  conceptTag: string,
  type: "commit" | "mcq"
): QuestionBankItem {
  return {
    id,
    conceptTag,
    type,
    prompt: question.prompt,
    options: question.options,
    correctIndex: question.correctIndex,
    explanation: question.explanation,
  };
}

export function buildMicroUnit(unit: AuthoredUnitWithPlan): {
  microUnit: MicroUnit;
  questions: QuestionBankItem[];
} {
  const { plan, authored } = unit;
  const hookId = `q-${plan.unitId}-h`;
  const retrieveIds = authored.retrieveQuestions.map(
    (_q, index) => `q-${plan.unitId}-r${index + 1}`
  );
  const questions: QuestionBankItem[] = [
    toQuestionBankItem(authored.hookQuestion, hookId, plan.conceptTag, "commit"),
    ...authored.retrieveQuestions.map((question, index) =>
      toQuestionBankItem(question, retrieveIds[index], plan.conceptTag, "mcq")
    ),
  ];
  const microUnit: MicroUnit = {
    unitId: plan.unitId,
    concept: plan.conceptTag,
    secondsBudget: plan.secondsBudget,
    hook: { type: "commit-question", questionRef: hookId },
    content: {
      narration: authored.narration,
      cards: authored.cards as MicroUnit["content"]["cards"],
    },
    retrieve: retrieveIds,
    anchor: authored.anchor as MicroUnit["anchor"],
  };
  return { microUnit, questions };
}

export function assembleCourseDefinition(input: {
  courseTitle: string;
  institutionName: string;
  pronunciationLexicon: unknown;
  excludedFacts: Fact[];
  moduleOrder: Array<{ moduleId: string; title: string }>;
  units: AuthoredUnitWithPlan[];
}): {
  definition: CourseDefinition;
  conceptKeysByUnitId: Record<string, string>;
} {
  const lexicon: Record<string, string> = {};
  if (
    input.pronunciationLexicon !== null &&
    typeof input.pronunciationLexicon === "object"
  ) {
    for (const [key, value] of Object.entries(
      input.pronunciationLexicon as Record<string, unknown>
    )) {
      if (typeof value === "string") lexicon[key] = value;
    }
  }

  const conceptKeysByUnitId: Record<string, string> = {};
  const questionBank: QuestionBankItem[] = [];
  const modules: CourseDefinition["modules"] = input.moduleOrder.map(
    (module) => ({
      moduleId: module.moduleId,
      title: module.title,
      microUnits: [],
    })
  );
  for (const unit of input.units) {
    conceptKeysByUnitId[unit.plan.unitId] = unit.plan.conceptKey;
    const { microUnit, questions } = buildMicroUnit(unit);
    questionBank.push(...questions);
    const module = modules.find((m) => m.moduleId === unit.plan.moduleId);
    if (!module) {
      throw new Error(
        `unit ${unit.plan.unitId} references unknown module ${unit.plan.moduleId}`
      );
    }
    module.microUnits.push(microUnit);
  }

  const definition: CourseDefinition = parseCourseDefinition({
    $schema: "counseliq://course-definition/v1",
    courseId: `${slugify(input.courseTitle)}-v1`,
    courseTitle: input.courseTitle,
    credentialLevel: 3,
    badge: `${input.institutionName} Specialist — ${input.courseTitle}`,
    prerequisite: "none",
    brandRef: slugify(input.institutionName),
    language: "en-AU",
    voice: {
      provider: "elevenlabs",
      voiceRef: "narrator-01",
      pronunciationLexicon: lexicon,
    },
    _pipelineNotes: {
      withheldFacts: input.excludedFacts.map((fact) => ({
        fact: fact.statement,
        provenance: fact.provenance.join(";"),
        reason: fact.flagReason
          ? `excluded during fact review (${fact.flagReason})`
          : "excluded during fact review",
      })),
      verificationFlags: [],
      assessmentGate:
        "Retrieve questions feed the adaptive scheduler; the badge assessment (roleplay) arrives in a later milestone.",
    },
    modules: modules.filter((module) => module.microUnits.length > 0),
    assessment: {
      type: "roleplay-consultation",
      scenarioRef: "rp-tbd",
      description:
        "Placeholder — roleplay assessment generation is a later milestone. MCQ fallback active.",
      passRubricThreshold: 0.8,
      mcqFallback: true,
    },
    questionBank,
  });

  return { definition, conceptKeysByUnitId };
}

/** Course-level code checks (assembly-time). */
export function courseComplianceViolations(input: {
  units: AuthoredUnitWithPlan[];
  questionBank: QuestionBankItem[];
}): string[] {
  return [
    ...validateQuestionConceptTags(
      input.units.map((unit) => ({
        unitId: unit.plan.unitId,
        conceptTag: unit.plan.conceptTag,
        questionIds: [
          `q-${unit.plan.unitId}-h`,
          ...unit.authored.retrieveQuestions.map(
            (_q, index) => `q-${unit.plan.unitId}-r${index + 1}`
          ),
        ],
      })),
      input.questionBank
    ),
    ...validateUniqueQuestionPrompts(input.questionBank),
  ];
}

export type AssemblyOutcome =
  | {
      status: "ok";
      definition: CourseDefinition;
      conceptKeysByUnitId: Record<string, string>;
      duplicatePromptUnitIds: string[];
    }
  | { status: "failed"; cause: string; duplicatePromptUnitIds: string[] };

export function tryAssemble(
  inventory: ReviewedInventory,
  courseTitle: string,
  moduleOrder: Array<{ moduleId: string; title: string }>,
  units: AuthoredUnitWithPlan[]
): AssemblyOutcome {
  let definition: CourseDefinition;
  let conceptKeysByUnitId: Record<string, string>;
  try {
    const result = assembleCourseDefinition({
      courseTitle,
      institutionName: inventory.institution.name,
      pronunciationLexicon: inventory.institution.pronunciationLexicon,
      excludedFacts: inventory.excludedFacts,
      moduleOrder,
      units,
    });
    definition = result.definition;
    conceptKeysByUnitId = result.conceptKeysByUnitId;
  } catch (error) {
    const cause =
      error instanceof CourseDefinitionParseError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      status: "failed",
      cause: `course definition assembly failed: ${cause}`,
      duplicatePromptUnitIds: [],
    };
  }

  const violations = courseComplianceViolations({
    units,
    questionBank: definition.questionBank,
  });
  if (violations.length === 0) {
    return {
      status: "ok",
      definition,
      conceptKeysByUnitId,
      duplicatePromptUnitIds: [],
    };
  }

  // Duplicate prompts are retryable per unit: the LATER question id in each
  // violation names the unit to re-author (ids are q-{unitId}-h|rN).
  const duplicateIds = violations
    .map((violation) =>
      violation.match(/and "(q-.+?)-(?:h|r\d+)" share an identical prompt/)
    )
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].replace(/^q-/, ""));
  return {
    status: "failed",
    cause: `course-level checks failed: ${violations.join("; ")}`,
    duplicatePromptUnitIds: [...new Set(duplicateIds)],
  };
}
