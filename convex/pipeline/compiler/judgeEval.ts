import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

/**
 * Judge-eval fixtures (`npm run eval:compile -- --judge-only`): seeds three
 * known-bad courses straight into the database and returns the runId so the
 * script can drive runQaJudge over each and assert the defect is caught.
 *
 * - hallucinated-fact:   narration asserts a ranking no inventory item
 *                        supports → expect unsupported-claim (flagged).
 * - provenance-stripped: narration cites a statistic whose supporting fact
 *                        was stripped from the inventory, on an unsourced
 *                        stat card → expect unsupported-claim (flagged).
 * - redundant-card:      a card transcribes its narration sentence verbatim
 *                        → mechanical candidate the judge must confirm as a
 *                        redundant-card flag.
 */

const KINDS = ["hallucinated-fact", "provenance-stripped", "redundant-card"] as const;
type BadCourseKind = (typeof KINDS)[number];

const PROVENANCE = "doc:judgeeval1:page:1";

const TRACED_SENTENCE = "Deakin has five campuses across Victoria.";

function badUnitContent(kind: BadCourseKind): {
  narration: Array<{ id: string; text: string }>;
  cards: Array<{
    template: string;
    props: Record<string, unknown>;
    enterAt: { narration: string; word: string };
    provenance: string;
  }>;
} {
  switch (kind) {
    case "hallucinated-fact":
      return {
        narration: [
          { id: "n1", text: TRACED_SENTENCE },
          {
            id: "n2",
            text: "Deakin is ranked number one in the world for graduate employability.",
          },
        ],
        cards: [
          {
            template: "map-card",
            props: { title: "Campus network", region: "Victoria" },
            enterAt: { narration: "n1", word: "campuses" },
            provenance: PROVENANCE,
          },
        ],
      };
    case "provenance-stripped":
      return {
        narration: [
          { id: "n1", text: TRACED_SENTENCE },
          {
            id: "n2",
            text: "Ninety-eight percent of Deakin graduates find full-time work within three months.",
          },
        ],
        cards: [
          {
            template: "stat-card",
            // Deliberately no sourceLabel — the provenance was stripped.
            props: { value: "98%", label: "graduates in full-time work" },
            enterAt: { narration: "n2", word: "Ninety-eight" },
            provenance: PROVENANCE,
          },
        ],
      };
    case "redundant-card":
      return {
        narration: [{ id: "n1", text: TRACED_SENTENCE }],
        cards: [
          {
            template: "text-card",
            // Verbatim transcript of n1 — Mayer redundancy violation.
            props: { text: TRACED_SENTENCE },
            enterAt: { narration: "n1", word: "campuses" },
            provenance: PROVENANCE,
          },
        ],
      };
  }
}

export const seedBadCourse = internalMutation({
  args: {
    kind: v.union(...KINDS.map((kind) => v.literal(kind))),
  },
  handler: async (ctx, args) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: `Judge eval — ${args.kind}`,
      brandTokens: {},
      pronunciationLexicon: {},
      market: "AU",
    });
    const runId = await ctx.db.insert("runs", {
      institutionId,
      state: "QA_RUNNING",
      promptVersions: {},
    });

    // The inventory the judge traces against: one concept, one approved fact.
    await ctx.db.insert("inventoryItems", {
      runId,
      kind: "concept",
      body: {
        type: "concept",
        key: "campuses",
        title: "Campus network",
        summary: "Where the university operates.",
        pageProvenance: [PROVENANCE],
      },
      provenance: [PROVENANCE],
      flagged: false,
    });
    await ctx.db.insert("inventoryItems", {
      runId,
      kind: "fact",
      body: {
        type: "fact",
        conceptKey: "campuses",
        statement: TRACED_SENTENCE,
        claimClass: "structural",
        provenance: [PROVENANCE],
        flagged: false,
      },
      claimClass: "structural",
      provenance: [PROVENANCE],
      flagged: false,
    });

    const courseId = await ctx.db.insert("courses", {
      institutionId,
      title: `Judge eval — ${args.kind}`,
      level: 3,
      version: 1,
      status: "in_review",
      definitionMeta: {
        schemaRef: "counseliq://course-definition/v1",
        courseId: `judge-eval-${args.kind}-v1`,
        badge: "Judge Eval",
        prerequisite: "none",
        brandRef: "judge-eval",
        language: "en-AU",
        voice: {
          provider: "elevenlabs",
          voiceRef: "narrator-01",
          pronunciationLexicon: {},
        },
        _pipelineNotes: {
          withheldFacts: [],
          verificationFlags: [],
          assessmentGate: "judge-eval fixture",
        },
        assessment: {
          type: "roleplay-consultation",
          scenarioRef: "rp-tbd",
          description: "judge-eval fixture",
          passRubricThreshold: 0.8,
          mcqFallback: true,
        },
      },
    });
    await ctx.db.patch(runId, { courseId });

    const { narration, cards } = badUnitContent(args.kind);
    await ctx.db.insert("microUnits", {
      courseId,
      moduleKey: "m1",
      moduleTitle: "Module 1",
      unitKey: "mu-bad-101",
      concept: "campuses",
      narration,
      cards,
      meta: {
        secondsBudget: 45,
        hook: { type: "commit-question", questionRef: "q-mu-bad-101-h" },
        retrieve: ["q-mu-bad-101-r1"],
        anchor: {
          template: "takeaway-card",
          props: { text: "Five campuses across Victoria." },
        },
        conceptKey: "campuses",
        order: { module: 0, unit: 0 },
      },
      state: "draft",
    });
    for (const question of [
      {
        id: "q-mu-bad-101-h",
        conceptTag: "campuses",
        type: "commit",
        prompt: "How many campuses would you expect a large university to run?",
        options: ["One", "Five"],
        correctIndex: 1,
        explanation: "Deakin runs five campuses.",
      },
      {
        id: "q-mu-bad-101-r1",
        conceptTag: "campuses",
        type: "mcq",
        prompt: "How many campuses does Deakin have?",
        options: ["Three", "Four", "Five", "Six"],
        correctIndex: 2,
        explanation: "Five campuses across Victoria.",
      },
    ]) {
      await ctx.db.insert("questions", {
        courseId,
        conceptTag: question.conceptTag,
        body: question,
      });
    }

    return { runId };
  },
});
