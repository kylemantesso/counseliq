import type {
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
  validateCardProvenance,
  validateGenericCardCap,
  validateQuestionConceptTags,
  validateStatisticCardsHaveSource,
  validateUniqueQuestionPrompts,
} from "./rules";

/**
 * Pure assembly + compliance logic for the M4 compiler: prompt input
 * builders, per-unit and course-level code-enforced checks, and the
 * CourseDefinition assembly. No Convex, no LLM, no node built-ins — fully
 * unit-testable. The orchestration lives in compile.ts ("use node").
 */

export interface UnitPlan {
  unitId: string;
  conceptKey: string;
  conceptTag: string;
  title: string;
  secondsBudget: number;
  moduleId: string;
  moduleTitle: string;
}

export interface AuthoredUnitWithPlan {
  plan: UnitPlan;
  authored: LlmAuthoredUnit;
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

export function buildUnitUserText(
  plan: UnitPlan,
  concept: Concept | undefined,
  facts: Fact[],
  courseTitle: string,
  institutionName: string,
  lexiconNames: string[],
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
  if (lexiconNames.length > 0) {
    parts.push(
      ``,
      `Names with pronunciation-lexicon entries (use exactly as spelled): ${lexiconNames.join(", ")}`
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

export function unitComplianceViolations(
  authored: LlmAuthoredUnit,
  knownProvenanceIds: ReadonlySet<string>
): string[] {
  const violations: string[] = [];

  const textBlobs: string[] = [
    ...authored.narration.map((s) => s.text),
    ...authored.cards.map((card) => cardText(card.props)),
    cardText(authored.anchor.props),
    authored.hookQuestion.prompt,
    ...authored.hookQuestion.options,
    authored.hookQuestion.explanation,
    ...authored.retrieveQuestions.flatMap((q) => [
      q.prompt,
      ...q.options,
      q.explanation,
    ]),
  ];
  for (const blob of textBlobs) {
    for (const hit of findBannedClaimsInText(blob)) {
      violations.push(
        `banned claim (${hit.code}): "${hit.excerpt}" — ${hit.description}`
      );
    }
  }

  violations.push(...validateGenericCardCap(authored.cards));
  violations.push(
    ...validateCardProvenance(authored.cards, knownProvenanceIds)
  );
  violations.push(...validateStatisticCardsHaveSource(authored.cards));

  return violations;
}

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
