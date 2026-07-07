import { describe, expect, test } from "vitest";
import type { CourseDefinition } from "@counseliq/course-schema";
import type { LlmClient } from "../llm/client";
import type { LlmJudgeCourse } from "./schemas";
import {
  buildJudgeUserText,
  collectCourseText,
  judgeCourse,
  mechanicalPrePass,
  type JudgeInventory,
} from "./judgeCore";
import {
  assembleCourseDefinition,
  type AuthoredUnitWithPlan,
} from "./assemble";

function makeUnit(
  unitId: string,
  narrationText: string,
  cardProps: Record<string, unknown> = { region: "Victoria" }
): AuthoredUnitWithPlan {
  return {
    plan: {
      unitId,
      conceptKey: "campuses",
      conceptTag: "campuses",
      title: "Campus network",
      secondsBudget: 45,
      moduleId: "m1",
      moduleTitle: "Why Deakin",
    },
    authored: {
      narration: [{ id: "n1", text: narrationText }],
      cards: [
        {
          template: "map-card",
          props: cardProps,
          enterAt: { narration: "n1", word: narrationText.split(" ")[0] },
          provenance: "doc:abc123:page:2",
        },
      ],
      hookQuestion: {
        prompt: `Hook for ${unitId}?`,
        options: ["Yes", "No"],
        correctIndex: 0,
        explanation: "Yes.",
      },
      retrieveQuestions: [
        {
          prompt: `Retrieve A ${unitId}?`,
          options: ["A", "B"],
          correctIndex: 0,
          explanation: "A.",
        },
        {
          prompt: `Retrieve B ${unitId}?`,
          options: ["A", "B"],
          correctIndex: 0,
          explanation: "A.",
        },
      ],
      anchor: { template: "takeaway-card", props: { text: `Anchor ${unitId}.` } },
    },
  };
}

function makeDefinition(units: AuthoredUnitWithPlan[]): CourseDefinition {
  return assembleCourseDefinition({
    courseTitle: "Deakin Essentials",
    institutionName: "Deakin University",
    pronunciationLexicon: {},
    excludedFacts: [],
    moduleOrder: [{ moduleId: "m1", title: "Why Deakin" }],
    units,
  }).definition;
}

const INVENTORY: JudgeInventory = {
  concepts: [
    {
      type: "concept",
      key: "campuses",
      title: "Campus network",
      summary: "Where Deakin operates.",
      pageProvenance: ["doc:abc123:page:2"],
    },
  ],
  facts: [
    {
      type: "fact",
      conceptKey: "campuses",
      statement: "Deakin has five campuses.",
      claimClass: "structural",
      provenance: ["doc:abc123:page:2"],
      flagged: false,
    },
  ],
  excludedFacts: [],
};

function mockJudge(output: LlmJudgeCourse): LlmClient {
  return {
    complete: async () => ({
      text: JSON.stringify(output),
      usage: {
        model: "mock/judge",
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
        latencyMs: 10,
      },
    }),
  };
}

const cleanJudgeOutput = (unitIds: string[]): LlmJudgeCourse => ({
  units: unitIds.map((unitId) => ({
    unitId,
    sentenceClassifications: [
      { narrationId: "n1", classification: "traced", refs: ["Deakin has five campuses."], note: null },
    ],
    flags: [],
  })),
  courseFlags: [],
  pass: true,
});

describe("mechanical pre-pass", () => {
  test("excluded-fact text in course content is a leak", () => {
    const definition = makeDefinition([
      makeUnit("mu-101", "The chancellor resigned amid a governance scandal."),
    ]);
    const { leaks } = mechanicalPrePass(definition, [
      { statement: "The chancellor resigned amid a governance scandal." },
    ]);
    expect(leaks).toHaveLength(1);
  });

  test("redundant card (narration transcript) becomes a candidate", () => {
    const definition = makeDefinition([
      makeUnit("mu-101", "Deakin has five campuses across Victoria.", {
        text: "Deakin has five campuses across Victoria.",
      }),
    ]);
    const { redundancyCandidates } = mechanicalPrePass(definition, []);
    expect(redundancyCandidates).toHaveLength(1);
    expect(redundancyCandidates[0].unitId).toBe("mu-101");
  });

  test("collectCourseText covers narration, cards, questions, anchors", () => {
    const definition = makeDefinition([
      makeUnit("mu-101", "Deakin has five campuses."),
    ]);
    const text = collectCourseText(definition);
    expect(text).toContain("Deakin has five campuses.");
    expect(text).toContain("Victoria");
    expect(text).toContain("Hook for mu-101?");
    expect(text).toContain("Anchor mu-101.");
  });
});

describe("judgeCourse", () => {
  test("a clean course passes with per-unit QA persisted shape", async () => {
    const definition = makeDefinition([
      makeUnit("mu-101", "Deakin has five campuses."),
    ]);
    const result = await judgeCourse(
      mockJudge(cleanJudgeOutput(["mu-101"])),
      definition,
      INVENTORY,
      { judgeModel: "mock/judge", now: 123 }
    );
    expect(result.verdict).toBe("passed");
    expect(result.errorCount).toBe(0);
    expect(result.unitQas["mu-101"].flags).toEqual([]);
    expect(result.unitQas["mu-101"].sentenceClassifications).toHaveLength(1);
    expect(result.unitQas["mu-101"].judgeModel).toBe("mock/judge");
    expect(result.unitQas["mu-101"].judgedAt).toBe(123);
    expect(result.usages).toHaveLength(1);
  });

  test("an unsupported classification forces a flag and a flagged verdict", async () => {
    const definition = makeDefinition([
      makeUnit("mu-101", "Deakin is ranked number one in the world."),
    ]);
    const output: LlmJudgeCourse = {
      units: [
        {
          unitId: "mu-101",
          sentenceClassifications: [
            {
              narrationId: "n1",
              classification: "unsupported",
              refs: [],
              note: "no inventory item supports this ranking",
            },
          ],
          // The judge "forgot" the flag — the classification still counts.
          flags: [],
        },
      ],
      courseFlags: [],
      pass: true,
    };
    const result = await judgeCourse(mockJudge(output), definition, INVENTORY, {
      judgeModel: "mock/judge",
    });
    expect(result.verdict).toBe("flagged");
    expect(
      result.unitQas["mu-101"].flags.some(
        (f) => f.code === "unsupported-claim" && f.severity === "error"
      )
    ).toBe(true);
  });

  test("an excluded-fact leak is a hard fail even when the judge passes", async () => {
    const definition = makeDefinition([
      makeUnit("mu-101", "The chancellor resigned amid a governance scandal."),
    ]);
    const inventory: JudgeInventory = {
      ...INVENTORY,
      excludedFacts: [
        {
          type: "fact",
          conceptKey: "campuses",
          statement: "The chancellor resigned amid a governance scandal.",
          claimClass: "institution_claim",
          provenance: ["doc:abc123:page:3"],
          flagged: true,
          excluded: true,
        },
      ],
    };
    const result = await judgeCourse(
      mockJudge(cleanJudgeOutput(["mu-101"])),
      definition,
      inventory,
      { judgeModel: "mock/judge" }
    );
    expect(result.verdict).toBe("flagged");
    expect(
      result.courseFlags.some(
        (f) => f.code === "excluded-fact-leak" && f.severity === "error"
      )
    ).toBe(true);
  });

  test("judge error flags produce a flagged verdict", async () => {
    const definition = makeDefinition([
      makeUnit("mu-101", "Deakin has five campuses."),
    ]);
    const output: LlmJudgeCourse = {
      units: [
        {
          unitId: "mu-101",
          sentenceClassifications: [
            { narrationId: "n1", classification: "traced", refs: ["x"], note: null },
          ],
          flags: [
            {
              code: "banned-claim",
              severity: "error",
              message: "promises a visa outcome in the hook explanation",
            },
          ],
        },
      ],
      courseFlags: [],
      pass: false,
    };
    const result = await judgeCourse(mockJudge(output), definition, INVENTORY, {
      judgeModel: "mock/judge",
    });
    expect(result.verdict).toBe("flagged");
    expect(result.errorCount).toBe(1);
  });

  test("units missing from the judge output get a warning flag", async () => {
    const definition = makeDefinition([
      makeUnit("mu-101", "Deakin has five campuses."),
      makeUnit("mu-102", "The Cloud Campus is fully online."),
    ]);
    const result = await judgeCourse(
      mockJudge(cleanJudgeOutput(["mu-101"])),
      definition,
      INVENTORY,
      { judgeModel: "mock/judge" }
    );
    // Warnings alone don't flag the course.
    expect(result.verdict).toBe("passed");
    expect(result.unitQas["mu-102"].flags).toEqual([
      {
        code: "judge-missing-unit",
        severity: "warning",
        message: "the judge returned no entry for this unit",
      },
    ]);
  });
});

describe("buildJudgeUserText", () => {
  test("includes course content, inventory grounding, and candidates", () => {
    const definition = makeDefinition([
      makeUnit("mu-101", "Deakin has five campuses."),
    ]);
    const text = buildJudgeUserText(definition, INVENTORY, [
      {
        unitId: "mu-101",
        cardIndex: 0,
        template: "map-card",
        overlap: 0.8,
        coverage: 0.75,
      },
    ]);
    expect(text).toContain('"unitId": "mu-101"');
    expect(text).toContain("Deakin has five campuses.");
    expect(text).toContain("Reviewed inventory");
    expect(text).toContain("Mechanical redundancy candidates");
    expect(text).toContain('"overlap": 0.8');
  });

  test("never contains excluded-fact text", () => {
    const definition = makeDefinition([
      makeUnit("mu-101", "Deakin has five campuses."),
    ]);
    const inventory: JudgeInventory = {
      ...INVENTORY,
      excludedFacts: [
        {
          type: "fact",
          conceptKey: "campuses",
          statement: "SECRET-EXCLUDED-STATEMENT",
          claimClass: "institution_claim",
          provenance: ["doc:abc123:page:3"],
          flagged: true,
          excluded: true,
        },
      ],
    };
    const text = buildJudgeUserText(definition, inventory, []);
    expect(text).not.toContain("SECRET-EXCLUDED-STATEMENT");
  });
});
