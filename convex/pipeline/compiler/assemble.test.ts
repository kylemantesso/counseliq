import { describe, expect, test } from "vitest";
import type { Fact } from "@counseliq/course-schema";
import type { LlmAuthoredUnit } from "./schemas";
import {
  assembleCourseDefinition,
  tryAssemble,
  unitComplianceViolations,
  type AuthoredUnitWithPlan,
  type ReviewedInventory,
  type UnitPlan,
} from "./assemble";

const KNOWN_PROVENANCE = new Set(["doc:abc123:page:2", "doc:abc123:page:3"]);

function makeAuthoredUnit(
  overrides: Partial<LlmAuthoredUnit> = {}
): LlmAuthoredUnit {
  return {
    narration: [
      { id: "n1", text: "Deakin University has five campuses across Victoria." },
      { id: "n2", text: "Its Burwood campus is the largest by enrolment." },
    ],
    cards: [
      {
        template: "map-card",
        props: { title: "Campus network", region: "Victoria" },
        enterAt: { narration: "n1", word: "campuses" },
        provenance: "doc:abc123:page:2",
      },
      {
        template: "stat-card",
        props: {
          value: "5",
          label: "campuses",
          sourceLabel: "Deakin facts 2024",
        },
        enterAt: { narration: "n2", word: "Burwood" },
        provenance: "doc:abc123:page:3",
      },
    ],
    hookQuestion: {
      prompt: "How many campuses does Deakin have?",
      options: ["Three", "Five"],
      correctIndex: 1,
      explanation: "Deakin has five campuses.",
    },
    retrieveQuestions: [
      {
        prompt: "Which Deakin campus is the largest?",
        options: ["Burwood", "Geelong", "Warrnambool", "Cloud"],
        correctIndex: 0,
        explanation: "Burwood is the largest by enrolment.",
      },
      {
        prompt: "In which state are Deakin's campuses located?",
        options: ["Victoria", "NSW", "Queensland", "WA"],
        correctIndex: 0,
        explanation: "All campuses are in Victoria.",
      },
    ],
    anchor: {
      template: "takeaway-card",
      props: { text: "Five campuses; Burwood is the largest." },
    },
    ...overrides,
  };
}

function makePlan(unitId: string, overrides: Partial<UnitPlan> = {}): UnitPlan {
  return {
    unitId,
    conceptKey: "campuses",
    conceptTag: "campuses",
    title: "Campus network",
    secondsBudget: 45,
    moduleId: "m1-why-deakin",
    moduleTitle: "Why Deakin",
    ...overrides,
  };
}

const EXCLUDED_FACT: Fact = {
  type: "fact",
  conceptKey: "campuses",
  statement: "An unverified claim about 99,999 students.",
  claimClass: "statistic",
  provenance: ["doc:abc123:page:9"],
  flagged: true,
  flagReason: "missing-source-or-year",
  excluded: true,
};

const INVENTORY: ReviewedInventory = {
  institution: {
    name: "Deakin University",
    market: "AU",
    pronunciationLexicon: { Geelong: "juh-LONG" },
  },
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
  excludedFacts: [EXCLUDED_FACT],
  provenanceIds: [...KNOWN_PROVENANCE],
};

describe("unitComplianceViolations", () => {
  test("a clean unit passes", () => {
    expect(
      unitComplianceViolations(makeAuthoredUnit(), KNOWN_PROVENANCE)
    ).toEqual([]);
  });

  test("banned claim in narration is caught", () => {
    const unit = makeAuthoredUnit({
      narration: [
        {
          id: "n1",
          text: "Graduates are guaranteed permanent residency after this degree, with five campuses to choose from.",
        },
        { id: "n2", text: "Its Burwood campus is the largest by enrolment." },
      ],
    });
    const violations = unitComplianceViolations(unit, KNOWN_PROVENANCE);
    expect(violations.some((v) => v.includes("banned claim"))).toBe(true);
  });

  test("unknown card provenance is caught", () => {
    const unit = makeAuthoredUnit();
    unit.cards[0] = { ...unit.cards[0], provenance: "doc:zzz999:page:9" };
    const violations = unitComplianceViolations(unit, KNOWN_PROVENANCE);
    expect(violations.some((v) => v.includes("provenance"))).toBe(true);
  });

  test("stat card without a sourceLabel is caught", () => {
    const unit = makeAuthoredUnit();
    unit.cards[1] = {
      ...unit.cards[1],
      props: { value: "5", label: "campuses" },
    };
    const violations = unitComplianceViolations(unit, KNOWN_PROVENANCE);
    expect(violations.some((v) => v.includes("sourceLabel"))).toBe(true);
  });
});

describe("assembleCourseDefinition", () => {
  test("produces a schema-valid definition with derived question ids", () => {
    const units: AuthoredUnitWithPlan[] = [
      { plan: makePlan("mu-101"), authored: makeAuthoredUnit() },
    ];
    const { definition, conceptKeysByUnitId } = assembleCourseDefinition({
      courseTitle: "Deakin Essentials",
      institutionName: "Deakin University",
      pronunciationLexicon: { Geelong: "juh-LONG" },
      excludedFacts: [EXCLUDED_FACT],
      moduleOrder: [{ moduleId: "m1-why-deakin", title: "Why Deakin" }],
      units,
    });

    expect(definition.courseId).toBe("deakin-essentials-v1");
    expect(definition.modules).toHaveLength(1);
    expect(definition.modules[0].microUnits[0].hook.questionRef).toBe(
      "q-mu-101-h"
    );
    expect(definition.modules[0].microUnits[0].retrieve).toEqual([
      "q-mu-101-r1",
      "q-mu-101-r2",
    ]);
    expect(definition.questionBank.map((q) => q.id)).toEqual([
      "q-mu-101-h",
      "q-mu-101-r1",
      "q-mu-101-r2",
    ]);
    expect(definition.questionBank[0].type).toBe("commit");
    expect(definition.questionBank[1].type).toBe("mcq");
    // Excluded facts land in _pipelineNotes, never in course content.
    expect(definition._pipelineNotes.withheldFacts).toHaveLength(1);
    expect(definition._pipelineNotes.withheldFacts[0].fact).toBe(
      EXCLUDED_FACT.statement
    );
    expect(definition.voice.pronunciationLexicon).toEqual({
      Geelong: "juh-LONG",
    });
    expect(conceptKeysByUnitId).toEqual({ "mu-101": "campuses" });
  });

  test("a unit referencing an unknown module throws", () => {
    expect(() =>
      assembleCourseDefinition({
        courseTitle: "Deakin Essentials",
        institutionName: "Deakin University",
        pronunciationLexicon: {},
        excludedFacts: [],
        moduleOrder: [{ moduleId: "m1-why-deakin", title: "Why Deakin" }],
        units: [
          {
            plan: makePlan("mu-101", { moduleId: "m9-missing" }),
            authored: makeAuthoredUnit(),
          },
        ],
      })
    ).toThrow(/unknown module/);
  });
});

describe("tryAssemble", () => {
  const moduleOrder = [{ moduleId: "m1-why-deakin", title: "Why Deakin" }];

  test("distinct units assemble cleanly", () => {
    const second = makeAuthoredUnit({
      hookQuestion: {
        prompt: "What is Deakin's largest campus?",
        options: ["Burwood", "Geelong"],
        correctIndex: 0,
        explanation: "Burwood.",
      },
      retrieveQuestions: [
        {
          prompt: "Roughly how many students attend Burwood?",
          options: ["10,000", "30,000", "50,000", "70,000"],
          correctIndex: 1,
          explanation: "About thirty thousand.",
        },
        {
          prompt: "Which campus offers cloud-based study?",
          options: ["Cloud Campus", "Burwood", "Geelong", "Warrnambool"],
          correctIndex: 0,
          explanation: "The Cloud Campus is fully online.",
        },
      ],
    });
    const outcome = tryAssemble(INVENTORY, "Deakin Essentials", moduleOrder, [
      { plan: makePlan("mu-101"), authored: makeAuthoredUnit() },
      { plan: makePlan("mu-102"), authored: second },
    ]);
    expect(outcome.status).toBe("ok");
  });

  test("duplicate prompts across units name the later unit for re-authoring", () => {
    const outcome = tryAssemble(INVENTORY, "Deakin Essentials", moduleOrder, [
      { plan: makePlan("mu-101"), authored: makeAuthoredUnit() },
      { plan: makePlan("mu-102"), authored: makeAuthoredUnit() },
    ]);
    expect(outcome.status).toBe("failed");
    expect(outcome.duplicatePromptUnitIds).toEqual(["mu-102"]);
  });
});
