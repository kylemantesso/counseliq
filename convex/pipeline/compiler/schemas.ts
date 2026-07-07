import { z } from "zod";
import { CARD_TEMPLATES, cardTemplateSchema } from "@counseliq/course-schema";

/**
 * LLM wire contracts for the M4 compiler and QA judge. Strict structured
 * outputs require every property to be present, so optional fields are
 * expressed as `nullable` on the wire. The Zod parse downstream is the
 * enforcement (completeStructured retries once with validator errors).
 */

// --- Structure pass (compile-structure) ---

export const llmUnitPlanSchema = z.object({
  /** Stable kebab-case unit id, unique within the course (e.g. mu-101). */
  unitId: z.string().min(1),
  /** ONE inventory concept key this unit teaches (one concept per unit). */
  conceptKey: z.string().min(1),
  /** kebab-case concept tag used on the unit + its questions. */
  conceptTag: z.string().min(1),
  /** Working title for the unit. */
  title: z.string().min(1),
  /** Content budget in seconds (60–90s content ≈ 25–90s per unit). */
  secondsBudget: z.number().int().min(20).max(90),
});

export const llmModulePlanSchema = z.object({
  /** Stable kebab-case module id (e.g. m1-why-institution). */
  moduleId: z.string().min(1),
  title: z.string().min(1),
  units: z.array(llmUnitPlanSchema).min(1),
});

export const llmCompileStructureSchema = z
  .object({
    courseTitle: z.string().min(1),
    modules: z.array(llmModulePlanSchema).min(1),
  })
  .superRefine((structure, ctx) => {
    const unitIds = new Set<string>();
    structure.modules.forEach((module, mIndex) => {
      module.units.forEach((unit, uIndex) => {
        if (unitIds.has(unit.unitId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["modules", mIndex, "units", uIndex, "unitId"],
            message: `duplicate unitId "${unit.unitId}"`,
          });
        }
        unitIds.add(unit.unitId);
      });
    });
  });

export type LlmUnitPlan = z.infer<typeof llmUnitPlanSchema>;
export type LlmModulePlan = z.infer<typeof llmModulePlanSchema>;
export type LlmCompileStructure = z.infer<typeof llmCompileStructureSchema>;

// --- Authoring pass (author-unit) ---

/**
 * Card props stay an open record until the per-template prop union merges
 * (cards track, Phase 0: NOT merged).
 * TODO(cards-track): validate props against the per-template discriminated
 * union from @counseliq/cards when it lands in course-schema.
 */
const llmCardPropsSchema = z.record(z.string(), z.unknown());

export const llmAuthoredCardSchema = z.object({
  template: cardTemplateSchema,
  props: llmCardPropsSchema,
  enterAt: z.object({
    /** Narration sentence id (must exist in this unit's narration). */
    narration: z.string().min(1),
    /** Word anchor (must be a substring of that narration sentence). */
    word: z.string().min(1),
  }),
  /**
   * `compiler:derived` for connective/instructional cards, otherwise the
   * provenance IDs of the inventory items backing the card, `;`-joined
   * (doc:{sourceDocId}:page:{n}).
   */
  provenance: z.string().min(1),
});

export const llmDraftQuestionSchema = z.object({
  prompt: z.string().min(1),
  /** 4 options; 2 allowed for true/false-style commit questions. */
  options: z.array(z.string().min(1)).min(2).max(4),
  correctIndex: z.number().int().nonnegative(),
  /** Explanation referencing the unit's facts. */
  explanation: z.string().min(1),
});

export const llmAuthoredUnitSchema = z
  .object({
    narration: z
      .array(
        z.object({
          /** n1, n2, … unique within the unit. */
          id: z.string().min(1),
          /** One TTS-friendly sentence. */
          text: z.string().min(1),
        })
      )
      .min(1),
    cards: z.array(llmAuthoredCardSchema).min(1),
    /** The commit question posed by the hook. */
    hookQuestion: llmDraftQuestionSchema,
    /** Retrieve (MCQ) questions testing this unit's concept. */
    retrieveQuestions: z.array(llmDraftQuestionSchema).min(2).max(3),
    /** Single-takeaway anchor card. */
    anchor: z.object({
      template: cardTemplateSchema,
      props: llmCardPropsSchema,
    }),
  })
  .superRefine((unit, ctx) => {
    const narrationById = new Map<string, string>();
    unit.narration.forEach((sentence, nIndex) => {
      if (narrationById.has(sentence.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["narration", nIndex, "id"],
          message: `duplicate narration id "${sentence.id}"`,
        });
      }
      narrationById.set(sentence.id, sentence.text);
    });

    unit.cards.forEach((card, cIndex) => {
      const narrationText = narrationById.get(card.enterAt.narration);
      if (narrationText === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cards", cIndex, "enterAt", "narration"],
          message: `enterAt.narration "${card.enterAt.narration}" does not match any narration sentence id`,
        });
      } else if (!narrationText.includes(card.enterAt.word)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cards", cIndex, "enterAt", "word"],
          message: `enterAt.word "${card.enterAt.word}" is not a substring of narration sentence "${card.enterAt.narration}"`,
        });
      }
    });

    const checkQuestion = (
      question: z.infer<typeof llmDraftQuestionSchema>,
      path: (string | number)[]
    ) => {
      if (question.correctIndex >= question.options.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "correctIndex"],
          message: `correctIndex ${question.correctIndex} is out of range (${question.options.length} options)`,
        });
      }
    };
    checkQuestion(unit.hookQuestion, ["hookQuestion"]);
    unit.retrieveQuestions.forEach((question, qIndex) =>
      checkQuestion(question, ["retrieveQuestions", qIndex])
    );
  });

export type LlmAuthoredCard = z.infer<typeof llmAuthoredCardSchema>;
export type LlmDraftQuestion = z.infer<typeof llmDraftQuestionSchema>;
export type LlmAuthoredUnit = z.infer<typeof llmAuthoredUnitSchema>;

// --- Judge pass (judge-course) ---

export const sentenceClassificationSchema = z.object({
  /** Narration sentence id within the unit. */
  narrationId: z.string().min(1),
  classification: z.enum(["traced", "derived", "unsupported"]),
  /** Inventory refs supporting a `traced` classification (else empty). */
  refs: z.array(z.string()),
  note: z.string().nullable(),
});

export const judgeFlagSchema = z.object({
  /** Stable kebab-case flag code, e.g. unsupported-claim, redundant-card. */
  code: z.string().min(1),
  severity: z.enum(["warning", "error"]),
  message: z.string().min(1),
});

export const llmJudgedUnitSchema = z.object({
  unitId: z.string().min(1),
  sentenceClassifications: z.array(sentenceClassificationSchema),
  flags: z.array(judgeFlagSchema),
});

export const llmJudgeCourseSchema = z.object({
  units: z.array(llmJudgedUnitSchema),
  courseFlags: z.array(judgeFlagSchema),
  /** false when any unsupported factual claim exists. */
  pass: z.boolean(),
});

export type SentenceClassification = z.infer<
  typeof sentenceClassificationSchema
>;
export type JudgeFlag = z.infer<typeof judgeFlagSchema>;
export type LlmJudgedUnit = z.infer<typeof llmJudgedUnitSchema>;
export type LlmJudgeCourse = z.infer<typeof llmJudgeCourseSchema>;

// --- QA persisted on microUnits.qa ---

export interface UnitQa {
  /** Judge verdict for this unit (flags may be empty). */
  flags: JudgeFlag[];
  sentenceClassifications: SentenceClassification[];
  /** versionTag of the judge prompt + model that produced this. */
  judgePromptVersion: string;
  judgeModel: string;
  judgedAt: number;
}

// --- Card template manifest (embedded in the author-unit prompt) ---

/** All card templates the authoring pass may use. */
export const CARD_TEMPLATE_MANIFEST = CARD_TEMPLATES;
