import { describe, expect, test } from "vitest";
import goldenFixture from "../fixtures/golden-fixture-1.json";
import { CARD_PROP_FIXTURES } from "./card-props-fixtures";
import {
  CARD_PROP_SCHEMAS,
  typedCardContentSchema,
  validateCardProps,
} from "./card-props";
import { CARD_TEMPLATES } from "./course-definition";
import type { CourseDefinition } from "./course-definition";

const golden = goldenFixture as CourseDefinition;

describe("CARD_PROP_SCHEMAS", () => {
  test("every card template has a registry schema and a fixture", () => {
    for (const template of CARD_TEMPLATES) {
      expect(CARD_PROP_SCHEMAS[template], `schema for ${template}`).toBeDefined();
      expect(CARD_PROP_FIXTURES[template], `fixture for ${template}`).toBeDefined();
    }
    expect(Object.keys(CARD_PROP_SCHEMAS).sort()).toEqual([...CARD_TEMPLATES].sort());
  });

  test("every fixture validates clean against its template schema", () => {
    for (const template of CARD_TEMPLATES) {
      const issues = validateCardProps(template, CARD_PROP_FIXTURES[template]);
      expect(issues, `${template}: ${issues.map((i) => i.message).join("; ")}`).toEqual([]);
    }
  });

  test("every fixture parses through the discriminated union", () => {
    for (const template of CARD_TEMPLATES) {
      const result = typedCardContentSchema.safeParse({
        template,
        props: CARD_PROP_FIXTURES[template],
      });
      expect(result.success, template).toBe(true);
    }
  });

  test("missing render-critical fields produce issues", () => {
    expect(validateCardProps("stat-card", { supporting: "no headline" })).not.toEqual([]);
    expect(validateCardProps("takeaway-card", {})).not.toEqual([]);
    expect(validateCardProps("myth-fact-card", { myth: "only half" })).not.toEqual([]);
    expect(validateCardProps("list-reveal", { heading: "empty", items: [] })).not.toEqual([]);
  });

  test("unknown template yields a single custom issue", () => {
    const issues = validateCardProps("hologram-card", { anything: true });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/Unknown card template "hologram-card"/);
  });

  test("unknown keys pass through untouched", () => {
    const props = {
      headline: "42nd",
      supporting: "in the world for nursing",
      sourceLabel: "QS 2024",
      verificationRequired: true,
    };
    expect(validateCardProps("stat-card", props)).toEqual([]);
    const parsed = CARD_PROP_SCHEMAS["stat-card"].parse(props);
    expect(parsed.verificationRequired).toBe(true);
  });

  test("every golden-fixture card and anchor validates with zero issues", () => {
    for (const module of golden.modules) {
      for (const unit of module.microUnits) {
        for (const card of unit.content.cards) {
          const issues = validateCardProps(card.template, card.props);
          expect(
            issues,
            `${unit.unitId} ${card.template}: ${issues.map((i) => i.message).join("; ")}`
          ).toEqual([]);
        }
        const anchorIssues = validateCardProps(unit.anchor.template, unit.anchor.props);
        expect(
          anchorIssues,
          `${unit.unitId} anchor ${unit.anchor.template}: ${anchorIssues
            .map((i) => i.message)
            .join("; ")}`
        ).toEqual([]);
      }
    }
  });
});
