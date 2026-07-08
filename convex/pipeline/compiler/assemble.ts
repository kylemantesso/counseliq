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
      `Cleared asset library (reference by "assetRef" = the id string EXACTLY as listed; never invent an id; video-card needs a video, photo-kenburns/image-text-card need an image):`,
      ...catalogue.map((asset) => JSON.stringify(asset))
    );
  } else {
    parts.push(
      ``,
      `No cleared media assets are available for this institution — do not emit video-card cards, and do not put an assetRef on any card.`
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
 * violations attached as warnings for gate-2 review — a run must not die
 * on an unattributed superlative or a pacing shortfall. The single
 * blocking exception is a rights-uncleared asset reference: "no
 * unknown-rights asset can appear in any course" stays mechanical.
 */
export function partitionComplianceViolations(violations: string[]): {
  blocking: string[];
  warnings: string[];
} {
  const blocking: string[] = [];
  const warnings: string[] = [];
  for (const violation of violations) {
    if (violation.includes("not rights-cleared")) blocking.push(violation);
    else warnings.push(violation);
  }
  return { blocking, warnings };
}

export function unitComplianceViolations(
  authored: LlmAuthoredUnit,
  knownProvenanceIds: ReadonlySet<string>,
  media: UnitMediaContext
): string[] {
  const violations: string[] = [];

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
  const narrationById = new Map(
    authored.narration.map((sentence) => [sentence.id, sentence.text])
  );
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
          ? `excluded at gate-1 review (${fact.flagReason})`
          : "excluded at gate-1 review",
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
