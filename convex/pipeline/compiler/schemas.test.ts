import { describe, expect, test } from "vitest";
import { llmAuthoredUnitSchema } from "./schemas";

/**
 * Wire-schema enforcement of per-template card props (course-schema
 * registry via superRefine). Issues land on the offending card's path so
 * completeStructured's validator-feedback retry tells the LLM what to fix.
 */

function makeUnit(overrides: Record<string, unknown> = {}) {
  return {
    narration: [
      { id: "n1", text: "La Trobe teaches forty thousand students." },
      { id: "n2", text: "Its Bundoora campus is the largest." },
    ],
    cards: [
      {
        template: "stat-card",
        props: {
          headline: "40,000",
          supporting: "students enrolled",
          sourceLabel: "Annual report 2024",
        },
        enterAt: { narration: "n1", word: "students" },
        provenance: "doc:abc:page:1",
      },
    ],
    hookQuestion: {
      prompt: "How many students?",
      options: ["Forty thousand", "Four thousand"],
      correctIndex: 0,
      explanation: "Forty thousand students are enrolled.",
    },
    retrieveQuestions: [
      {
        prompt: "Largest campus?",
        options: ["Bundoora", "City", "Bendigo", "Albury"],
        correctIndex: 0,
        explanation: "Bundoora is the largest campus.",
      },
      {
        prompt: "Student count?",
        options: ["40,000", "4,000", "400", "40"],
        correctIndex: 0,
        explanation: "Forty thousand students.",
      },
    ],
    anchor: {
      template: "takeaway-card",
      props: { text: "Forty thousand students, centred on Bundoora." },
    },
    ...overrides,
  };
}

describe("llmAuthoredUnitSchema card-prop enforcement", () => {
  test("valid unit with per-template props parses", () => {
    expect(llmAuthoredUnitSchema.safeParse(makeUnit()).success).toBe(true);
  });

  test("stat-card missing headline fails at the card's path", () => {
    const unit = makeUnit();
    (unit.cards as Array<{ props: Record<string, unknown> }>)[0].props = {
      supporting: "students enrolled",
      sourceLabel: "Annual report 2024",
    };
    const result = llmAuthoredUnitSchema.safeParse(unit);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((entry) =>
        entry.path.join(".").startsWith("cards.0.props")
      );
      expect(issue).toBeDefined();
      expect(issue?.path.join(".")).toContain("headline");
    }
  });

  test("anchor props are enforced too", () => {
    const unit = makeUnit({
      anchor: { template: "takeaway-card", props: {} },
    });
    const result = llmAuthoredUnitSchema.safeParse(unit);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((entry) =>
          entry.path.join(".").startsWith("anchor.props")
        )
      ).toBe(true);
    }
  });

  test("unknown card template is rejected", () => {
    const unit = makeUnit();
    (unit.cards as Array<{ template: string }>)[0].template = "hologram-card";
    expect(llmAuthoredUnitSchema.safeParse(unit).success).toBe(false);
  });
});
