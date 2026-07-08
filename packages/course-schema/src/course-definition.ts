import { z } from "zod";

/**
 * Course Definition interchange schema — the contract between the compiler
 * (which emits this JSON), CI validation, and downstream consumers (TTS,
 * mobile renderer). Modeled exactly on fixtures/golden-fixture-1.json.
 */

export const CARD_TEMPLATES = [
  // Present in the golden fixture
  "title-card",
  "stat-card",
  "list-reveal",
  "comparison-split",
  "quote-card",
  "map-card",
  "timeline-card",
  "document-callout",
  "photo-kenburns",
  "takeaway-card",
  "pathway-card",
  "persona-card",
  "alert-card",
  "breakdown-card",
  "myth-fact-card",
  // Additional templates in the M1 contract
  "text-card",
  "term-card",
  "image-text-card",
  "chart-card",
  "date-card",
  "checklist-card",
  // M6 media enrichment
  "video-card",
] as const;

export const cardTemplateSchema = z.enum(CARD_TEMPLATES);

// Per-template prop schemas are a later milestone; props stay open for M1.
const cardPropsSchema = z.record(z.string(), z.unknown());

export const narrationSentenceSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();

export const enterAtSchema = z
  .object({
    narration: z.string().min(1),
    word: z.string().min(1),
  })
  .strict();

export const cardSchema = z
  .object({
    template: cardTemplateSchema,
    props: cardPropsSchema,
    enterAt: enterAtSchema,
    provenance: z.string().min(1),
  })
  .strict();

export const anchorSchema = z
  .object({
    template: cardTemplateSchema,
    props: cardPropsSchema,
  })
  .strict();

export const hookSchema = z
  .object({
    type: z.literal("commit-question"),
    questionRef: z.string().min(1),
  })
  .strict();

export const microUnitSchema = z
  .object({
    unitId: z.string().min(1),
    concept: z.string().min(1),
    secondsBudget: z.number().int().positive(),
    hook: hookSchema,
    content: z
      .object({
        narration: z.array(narrationSentenceSchema).min(1),
        cards: z.array(cardSchema).min(1),
      })
      .strict(),
    retrieve: z.array(z.string().min(1)),
    anchor: anchorSchema,
  })
  .strict();

export const moduleSchema = z
  .object({
    moduleId: z.string().min(1),
    title: z.string().min(1),
    microUnits: z.array(microUnitSchema).min(1),
  })
  .strict();

export const questionBankItemSchema = z
  .object({
    id: z.string().min(1),
    conceptTag: z.string().min(1),
    type: z.union([z.literal("commit"), z.literal("mcq")]),
    prompt: z.string().min(1),
    options: z.array(z.string().min(1)).min(2),
    correctIndex: z.number().int().nonnegative(),
    explanation: z.string().min(1),
  })
  .strict();

export const voiceSchema = z
  .object({
    provider: z.string().min(1),
    voiceRef: z.string().min(1),
    pronunciationLexicon: z.record(z.string(), z.string()),
  })
  .strict();

export const pipelineNotesSchema = z
  .object({
    withheldFacts: z.array(
      z
        .object({
          fact: z.string().min(1),
          provenance: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict()
    ),
    verificationFlags: z.array(
      z
        .object({
          fact: z.string().min(1),
          provenance: z.string().min(1),
          note: z.string().min(1),
        })
        .strict()
    ),
    assessmentGate: z.string().min(1),
  })
  .strict();

export const assessmentSchema = z
  .object({
    type: z.string().min(1),
    scenarioRef: z.string().min(1),
    description: z.string().min(1),
    passRubricThreshold: z.number().min(0).max(1),
    mcqFallback: z.boolean(),
  })
  .strict();

const courseDefinitionObjectSchema = z
  .object({
    $schema: z.string().min(1),
    courseId: z.string().min(1),
    courseTitle: z.string().min(1),
    credentialLevel: z.number().int().positive(),
    badge: z.string().min(1),
    prerequisite: z.string().min(1),
    brandRef: z.string().min(1),
    language: z.string().min(1),
    voice: voiceSchema,
    _pipelineNotes: pipelineNotesSchema,
    modules: z.array(moduleSchema).min(1),
    assessment: assessmentSchema,
    questionBank: z.array(questionBankItemSchema).min(1),
  })
  .strict();

export const courseDefinitionSchema = courseDefinitionObjectSchema.superRefine(
  (course, ctx) => {
    const questionIds = new Set(course.questionBank.map((q) => q.id));

    course.questionBank.forEach((question, qIndex) => {
      if (question.correctIndex >= question.options.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questionBank", qIndex, "correctIndex"],
          message: `correctIndex ${question.correctIndex} is out of range for question "${question.id}" (${question.options.length} options)`,
        });
      }
    });

    course.modules.forEach((module, mIndex) => {
      module.microUnits.forEach((unit, uIndex) => {
        const unitPath = ["modules", mIndex, "microUnits", uIndex];

        if (!questionIds.has(unit.hook.questionRef)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...unitPath, "hook", "questionRef"],
            message: `hook.questionRef "${unit.hook.questionRef}" in unit "${unit.unitId}" does not exist in questionBank`,
          });
        }

        unit.retrieve.forEach((questionRef, rIndex) => {
          if (!questionIds.has(questionRef)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...unitPath, "retrieve", rIndex],
              message: `retrieve ref "${questionRef}" in unit "${unit.unitId}" does not exist in questionBank`,
            });
          }
        });

        const narrationById = new Map(
          unit.content.narration.map((sentence) => [sentence.id, sentence.text])
        );

        unit.content.cards.forEach((card, cIndex) => {
          const cardPath = [...unitPath, "content", "cards", cIndex];
          const narrationText = narrationById.get(card.enterAt.narration);

          if (narrationText === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...cardPath, "enterAt", "narration"],
              message: `enterAt.narration "${card.enterAt.narration}" in unit "${unit.unitId}" does not match any narration sentence id`,
            });
          } else if (!narrationText.includes(card.enterAt.word)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...cardPath, "enterAt", "word"],
              message: `enterAt.word "${card.enterAt.word}" is not a substring of narration "${card.enterAt.narration}" in unit "${unit.unitId}"`,
            });
          }
        });
      });
    });
  }
);

export type CourseDefinition = z.infer<typeof courseDefinitionSchema>;
export type CourseModule = z.infer<typeof moduleSchema>;
export type MicroUnit = z.infer<typeof microUnitSchema>;
export type Card = z.infer<typeof cardSchema>;
export type CardTemplate = z.infer<typeof cardTemplateSchema>;
export type NarrationSentence = z.infer<typeof narrationSentenceSchema>;
export type QuestionBankItem = z.infer<typeof questionBankItemSchema>;
export type CourseAssessment = z.infer<typeof assessmentSchema>;
export type CourseVoice = z.infer<typeof voiceSchema>;
export type PipelineNotes = z.infer<typeof pipelineNotesSchema>;

export class CourseDefinitionParseError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    const details = issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    super(`Invalid course definition (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n${details}`);
    this.name = "CourseDefinitionParseError";
    this.issues = issues;
  }
}

/** Parse an untrusted value into a CourseDefinition, throwing a readable error on failure. */
export function parseCourseDefinition(input: unknown): CourseDefinition {
  const result = courseDefinitionSchema.safeParse(input);
  if (!result.success) {
    throw new CourseDefinitionParseError(result.error.issues);
  }
  return result.data;
}
