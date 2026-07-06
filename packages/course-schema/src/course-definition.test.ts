import { describe, expect, test } from "vitest";
import goldenFixture from "../fixtures/golden-fixture-1.json";
import {
  CourseDefinitionParseError,
  parseCourseDefinition,
} from "./course-definition";
import type { CourseDefinition } from "./course-definition";

function cloneFixture(): CourseDefinition {
  return structuredClone(goldenFixture) as CourseDefinition;
}

describe("parseCourseDefinition", () => {
  test("golden fixture parses clean", () => {
    const course = parseCourseDefinition(goldenFixture);

    expect(course.courseId).toBe("latrobe-health-portfolio-v1");
    expect(course.modules).toHaveLength(4);
    expect(course.questionBank).toHaveLength(31);
    expect(course.modules[0].microUnits[0].hook.questionRef).toBe("q-h101");
  });

  test("fails when a hook.questionRef is missing from the question bank", () => {
    const mutated = cloneFixture();
    mutated.modules[0].microUnits[0].hook.questionRef = "q-does-not-exist";

    expect(() => parseCourseDefinition(mutated)).toThrowError(
      CourseDefinitionParseError
    );
    expect(() => parseCourseDefinition(mutated)).toThrowError(
      /hook\.questionRef "q-does-not-exist" in unit "mu-health-101" does not exist in questionBank/
    );
  });

  test("fails when a retrieve ref is missing from the question bank", () => {
    const mutated = cloneFixture();
    mutated.modules[1].microUnits[0].retrieve[0] = "q-ghost";

    expect(() => parseCourseDefinition(mutated)).toThrowError(
      /retrieve ref "q-ghost" in unit "mu-health-201" does not exist in questionBank/
    );
  });

  test("fails when enterAt.word is not a substring of the referenced narration", () => {
    const mutated = cloneFixture();
    mutated.modules[0].microUnits[0].content.cards[1].enterAt.word =
      "zeppelin";

    expect(() => parseCourseDefinition(mutated)).toThrowError(
      CourseDefinitionParseError
    );
    expect(() => parseCourseDefinition(mutated)).toThrowError(
      /enterAt\.word "zeppelin" is not a substring of narration "n2" in unit "mu-health-101"/
    );
  });

  test("fails when a correctIndex is out of range", () => {
    const mutated = cloneFixture();
    mutated.questionBank[0].correctIndex = 99;

    expect(() => parseCourseDefinition(mutated)).toThrowError(
      CourseDefinitionParseError
    );
    expect(() => parseCourseDefinition(mutated)).toThrowError(
      /correctIndex 99 is out of range for question "q-h101" \(4 options\)/
    );
  });

  test("error message aggregates issues with paths", () => {
    try {
      parseCourseDefinition({ courseId: 42 });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CourseDefinitionParseError);
      const message = (error as CourseDefinitionParseError).message;
      expect(message).toContain("Invalid course definition");
      expect(message).toContain("courseId");
    }
  });
});
