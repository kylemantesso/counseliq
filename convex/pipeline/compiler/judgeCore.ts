import type {
  Concept,
  CourseDefinition,
  Fact,
  MicroUnit,
  QuestionBankItem,
} from "@counseliq/course-schema";
import {
  completeStructured,
  type LlmClient,
  type LlmUsage,
} from "../llm/client";
import { JUDGE_COURSE_JSON_SCHEMA } from "../llm/schemas";
import { PROMPTS } from "../prompts";
import {
  llmJudgeCourseSchema,
  type JudgeFlag,
  type LlmJudgeCourse,
  type UnitQa,
} from "./schemas";
import {
  cardText,
  findExcludedFactLeaks,
  findRedundantCards,
  type ExcludedFactLeak,
  type RedundancyCandidate,
} from "./rules";

/**
 * Pure QA-judge logic: the mechanical pre-pass (redundancy candidates +
 * excluded-fact leak hard fail), the judge prompt build, and the verdict
 * derivation from the judge's structured output. No Convex — unit tests
 * drive this with a mocked LlmClient. Orchestration/persistence lives in
 * judge.ts.
 */

export interface JudgeInventory {
  concepts: Concept[];
  facts: Fact[];
  excludedFacts: Fact[];
}

// --- Mechanical pre-pass ---

function allUnits(definition: CourseDefinition): MicroUnit[] {
  return definition.modules.flatMap((module) => module.microUnits);
}

/** Every learner-visible text in the course, one blob (leak check input). */
export function collectCourseText(definition: CourseDefinition): string {
  const parts: string[] = [];
  for (const unit of allUnits(definition)) {
    for (const sentence of unit.content.narration) parts.push(sentence.text);
    for (const card of unit.content.cards) parts.push(cardText(card.props));
    parts.push(cardText(unit.anchor.props));
  }
  for (const question of definition.questionBank) {
    parts.push(question.prompt, ...question.options, question.explanation);
  }
  return parts.join("\n");
}

export interface MechanicalPrePass {
  /** Excluded-fact text found in course content — hard fail. */
  leaks: ExcludedFactLeak[];
  /** >60% card/narration token-overlap candidates for the judge to confirm. */
  redundancyCandidates: RedundancyCandidate[];
}

export function mechanicalPrePass(
  definition: CourseDefinition,
  excludedFacts: Array<{ statement: string }>
): MechanicalPrePass {
  const leaks = findExcludedFactLeaks(
    collectCourseText(definition),
    excludedFacts
  );
  const redundancyCandidates = allUnits(definition).flatMap((unit) =>
    findRedundantCards({
      unitId: unit.unitId,
      narration: unit.content.narration,
      cards: unit.content.cards,
    })
  );
  return { leaks, redundancyCandidates };
}

// --- Judge prompt input ---

export function buildJudgeUserText(
  definition: CourseDefinition,
  inventory: JudgeInventory,
  redundancyCandidates: RedundancyCandidate[]
): string {
  const questionById = new Map(
    definition.questionBank.map((question) => [question.id, question])
  );
  const questionForPrompt = (id: string) => {
    const question = questionById.get(id);
    return question
      ? {
          id: question.id,
          type: question.type,
          prompt: question.prompt,
          options: question.options,
          correctIndex: question.correctIndex,
          explanation: question.explanation,
        }
      : { id, missing: true };
  };
  const courseListing = definition.modules.map((module) => ({
    moduleId: module.moduleId,
    title: module.title,
    units: module.microUnits.map((unit) => ({
      unitId: unit.unitId,
      concept: unit.concept,
      narration: unit.content.narration,
      cards: unit.content.cards.map((card) => ({
        template: card.template,
        props: card.props,
        enterAt: card.enterAt,
        provenance: card.provenance,
      })),
      hookQuestion: questionForPrompt(unit.hook.questionRef),
      retrieveQuestions: unit.retrieve.map(questionForPrompt),
      anchor: unit.anchor,
    })),
  }));
  const inventoryListing = {
    concepts: inventory.concepts.map((concept) => ({
      key: concept.key,
      title: concept.title,
      summary: concept.summary,
    })),
    approvedFacts: inventory.facts.map((fact) => ({
      conceptKey: fact.conceptKey,
      statement: fact.statement,
      claimClass: fact.claimClass,
      sourceLabel: fact.sourceLabel ?? null,
      year: fact.year ?? null,
      provenance: fact.provenance,
    })),
  };
  return [
    `Compiled course "${definition.courseTitle}":`,
    JSON.stringify(courseListing, null, 2),
    ``,
    `Reviewed inventory (the ONLY legitimate factual grounding):`,
    JSON.stringify(inventoryListing, null, 2),
    ``,
    `Mechanical redundancy candidates (confirm or clear each):`,
    JSON.stringify(redundancyCandidates, null, 2),
  ].join("\n");
}

// --- Verdict derivation ---

export interface JudgeVerdict {
  verdict: "passed" | "flagged";
  /** Per-unit QA payload keyed by unitId (an entry for EVERY course unit). */
  unitQas: Record<string, UnitQa>;
  /** Course-level flags: judge courseFlags + mechanical hard fails. */
  courseFlags: JudgeFlag[];
  errorCount: number;
  warningCount: number;
}

export function deriveVerdict(input: {
  definition: CourseDefinition;
  judgeOutput: LlmJudgeCourse;
  leaks: ExcludedFactLeak[];
  judgePromptVersion: string;
  judgeModel: string;
  judgedAt: number;
}): JudgeVerdict {
  const judgedByUnitId = new Map(
    input.judgeOutput.units.map((unit) => [unit.unitId, unit])
  );

  const unitQas: Record<string, UnitQa> = {};
  for (const unit of allUnits(input.definition)) {
    const judged = judgedByUnitId.get(unit.unitId);
    const flags: JudgeFlag[] = judged
      ? [...judged.flags]
      : [
          {
            code: "judge-missing-unit",
            severity: "warning",
            message: "the judge returned no entry for this unit",
          },
        ];
    // An unsupported factual claim is an error even if the judge forgot to
    // emit the matching flag — the classification is the source of truth.
    if (
      judged &&
      judged.sentenceClassifications.some(
        (s) => s.classification === "unsupported"
      ) &&
      !flags.some((flag) => flag.code === "unsupported-claim")
    ) {
      flags.push({
        code: "unsupported-claim",
        severity: "error",
        message:
          "one or more narration sentences were classified as unsupported",
      });
    }
    unitQas[unit.unitId] = {
      flags,
      sentenceClassifications: judged?.sentenceClassifications ?? [],
      judgePromptVersion: input.judgePromptVersion,
      judgeModel: input.judgeModel,
      judgedAt: input.judgedAt,
    };
  }

  const courseFlags: JudgeFlag[] = [
    ...input.judgeOutput.courseFlags,
    ...input.leaks.map(
      (leak): JudgeFlag => ({
        code: "excluded-fact-leak",
        severity: "error",
        message: `excluded fact appears in course content: "${leak.factStatement}" (matched: ${leak.matchedTokens.join(", ")})`,
      })
    ),
  ];

  const allFlags = [
    ...courseFlags,
    ...Object.values(unitQas).flatMap((qa) => qa.flags),
  ];
  const errorCount = allFlags.filter((f) => f.severity === "error").length;
  const warningCount = allFlags.filter((f) => f.severity === "warning").length;
  const flagged =
    errorCount > 0 || input.leaks.length > 0 || !input.judgeOutput.pass;

  return {
    verdict: flagged ? "flagged" : "passed",
    unitQas,
    courseFlags,
    errorCount,
    warningCount,
  };
}

// --- Full judge pass (mechanical + LLM + verdict) ---

export interface JudgeRunResult extends JudgeVerdict {
  usages: LlmUsage[];
  redundancyCandidates: RedundancyCandidate[];
}

export async function judgeCourse(
  client: LlmClient,
  definition: CourseDefinition,
  inventory: JudgeInventory,
  options: { judgeModel: string; now?: number }
): Promise<JudgeRunResult> {
  const { leaks, redundancyCandidates } = mechanicalPrePass(
    definition,
    inventory.excludedFacts
  );

  const { value: judgeOutput, usages } =
    await completeStructured<LlmJudgeCourse>(
      client,
      "judge-course",
      {
        system: PROMPTS["judge-course"].content,
        user: [
          {
            type: "text",
            text: buildJudgeUserText(definition, inventory, redundancyCandidates),
          },
        ],
        schemaName: "judge_course",
        jsonSchema: JUDGE_COURSE_JSON_SCHEMA,
      },
      llmJudgeCourseSchema
    );

  const verdict = deriveVerdict({
    definition,
    judgeOutput,
    leaks,
    judgePromptVersion: PROMPTS["judge-course"].versionTag,
    judgeModel: options.judgeModel,
    judgedAt: options.now ?? Date.now(),
  });
  return { ...verdict, usages, redundancyCandidates };
}
