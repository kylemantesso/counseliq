import { describe, expect, test } from "vitest";
import { llmAuthoredUnitSchema } from "./schemas";
import { AUTHOR_UNIT_JSON_SCHEMA } from "../llm/schemas";

/**
 * Per-template card props are enforced on the wire (discriminated union in
 * the generated JSON schema, steering structured-output providers at
 * generation time) and at the Zod parse. Issues land on the offending
 * card's path so completeStructured's validator-feedback retry tells the
 * LLM what to fix.
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

  test("over-long anchor takeaway text is rejected with rewrite guidance", () => {
    const unit = makeUnit({
      anchor: {
        template: "takeaway-card",
        props: {
          text:
            "La Trobe University's Acknowledgement of Country recognises " +
            "Traditional Custodians and commits to providing opportunities " +
            "for Aboriginal and Torres Strait Islander students across all " +
            "of its campuses in Victoria and beyond.",
        },
      },
    });
    const result = llmAuthoredUnitSchema.safeParse(unit);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (entry) => entry.path.join(".") === "anchor.props.text"
      );
      expect(issue?.message).toContain("160 characters");
    }
  });

  test("over-long text-card body is rejected with compress guidance", () => {
    const unit = makeUnit();
    (unit.cards as Array<Record<string, unknown>>)[0] = {
      template: "text-card",
      props: {
        heading: "Commitment",
        body:
          "La Trobe University is committed to providing opportunities for " +
          "Aboriginal and Torres Strait Islander people, both as individuals " +
          "and communities, through teaching, learning, research, and " +
          "partnerships across all its campuses.",
      },
      enterAt: { narration: "n1", word: "students" },
      provenance: "doc:abc:page:1",
    };
    const result = llmAuthoredUnitSchema.safeParse(unit);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (entry) => entry.path.join(".") === "cards.0.props.body"
      );
      expect(issue?.message).toContain("200 characters");
    }
  });

  test("text-card body within the cap parses", () => {
    const unit = makeUnit();
    (unit.cards as Array<Record<string, unknown>>)[0] = {
      template: "text-card",
      props: {
        heading: "Commitment",
        body: "Committed to opportunities for Aboriginal and Torres Strait Islander people across all campuses.",
      },
      enterAt: { narration: "n1", word: "students" },
      provenance: "doc:abc:page:1",
    };
    expect(llmAuthoredUnitSchema.safeParse(unit).success).toBe(true);
  });

  test("over-long myth-fact halves are each rejected at their own path", () => {
    const longHalf =
      "International students who complete this degree are guaranteed " +
      "permanent residency and immediate employment in Australia, according " +
      "to persistent word-of-mouth among some counselling networks.";
    const unit = makeUnit();
    (unit.cards as Array<Record<string, unknown>>)[0] = {
      template: "myth-fact-card",
      props: { myth: longHalf, fact: longHalf },
      enterAt: { narration: "n1", word: "students" },
      provenance: "doc:abc:page:1",
    };
    const result = llmAuthoredUnitSchema.safeParse(unit);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((entry) => entry.path.join("."));
      expect(paths).toContain("cards.0.props.myth");
      expect(paths).toContain("cards.0.props.fact");
    }
  });

  test("non-takeaway anchor display text is capped too", () => {
    const unit = makeUnit({
      anchor: {
        template: "text-card",
        props: {
          body:
            "La Trobe University is committed to providing opportunities for " +
            "Aboriginal and Torres Strait Islander people, both as individuals " +
            "and communities, through teaching, learning, research, and " +
            "partnerships across all its campuses.",
        },
      },
    });
    const result = llmAuthoredUnitSchema.safeParse(unit);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (entry) => entry.path.join(".") === "anchor.props.body"
      );
      expect(issue?.message).toContain("200 characters");
    }
  });

  test("unknown card template is rejected", () => {
    const unit = makeUnit();
    (unit.cards as Array<{ template: string }>)[0].template = "hologram-card";
    expect(llmAuthoredUnitSchema.safeParse(unit).success).toBe(false);
  });

  test("null-valued optional props are stripped, not rejected", () => {
    const unit = makeUnit();
    (unit.cards as Array<{ props: Record<string, unknown> }>)[0].props = {
      headline: "40,000",
      supporting: null,
      kicker: null,
      sourceLabel: "Annual report 2024",
    };
    const result = llmAuthoredUnitSchema.safeParse(unit);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cards[0].props).not.toHaveProperty("supporting");
    }
  });

  test("list props are rejected when the model emits a string", () => {
    const unit = makeUnit();
    (unit.cards as Array<Record<string, unknown>>)[0] = {
      template: "list-reveal",
      props: { heading: "Key points", items: "• one\n• two" },
      enterAt: { narration: "n1", word: "students" },
      provenance: "doc:abc:page:1",
    };
    const result = llmAuthoredUnitSchema.safeParse(unit);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((entry) =>
        entry.path.join(".").includes("items")
      );
      expect(issue).toBeDefined();
    }
  });
});

describe("AUTHOR_UNIT_JSON_SCHEMA wire shape", () => {
  type JsonSchema = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  function cardBranches(schema: JsonSchema): JsonSchema[] {
    const items = schema.properties?.cards?.items ?? {};
    return (items.anyOf ?? items.oneOf ?? []) as JsonSchema[];
  }

  function branchFor(template: string): JsonSchema | undefined {
    return cardBranches(AUTHOR_UNIT_JSON_SCHEMA as JsonSchema).find(
      (branch) =>
        branch.properties?.template?.const === template ||
        branch.properties?.template?.enum?.[0] === template
    );
  }

  test("cards are a discriminated union on the wire (22 branches)", () => {
    expect(cardBranches(AUTHOR_UNIT_JSON_SCHEMA as JsonSchema)).toHaveLength(22);
  });

  test("list-reveal items are typed as an array on the wire", () => {
    const branch = branchFor("list-reveal");
    expect(branch).toBeDefined();
    const items = branch?.properties?.props?.properties?.items;
    expect(items?.type).toBe("array");
  });

  test("stat-card headline is required on the wire", () => {
    const branch = branchFor("stat-card");
    expect(branch?.properties?.props?.required ?? []).toContain("headline");
  });
});
