import { describe, expect, test } from "vitest";
import { fallbackAssignments, validateAssignments } from "./assign";

const looks = [
  {
    lookId: "campus",
    groupId: "g1",
    name: "Outdoor campus",
    previewImageUrl: null,
    preferredOrientation: "portrait" as const,
    supportedEngines: ["avatar_iv"],
    tags: ["outdoors", "campus"],
    evaluation: {
      description: "Presenter outside on a university campus",
      setting: "outdoor campus",
      attire: "casual",
      framing: "medium",
      tone: "welcoming",
      suitableTopics: ["campus life", "student experience"],
      visualTags: ["outdoors", "campus"],
    },
  },
  {
    lookId: "lab",
    groupId: "g1",
    name: "Laboratory",
    previewImageUrl: null,
    preferredOrientation: "portrait" as const,
    supportedEngines: ["avatar_iv"],
    tags: ["laboratory", "science"],
    evaluation: {
      description: "Presenter inside a science laboratory",
      setting: "laboratory",
      attire: "professional",
      framing: "medium",
      tone: "technical",
      suitableTopics: ["research", "science facilities"],
      visualTags: ["lab", "science"],
    },
  },
];

const unit = (unitKey: string, concept: string) => ({
  unitKey,
  moduleKey: "module",
  moduleTitle: "Module",
  concept,
  narration: [{ id: "n1", text: concept }],
});

describe("avatar look assignment", () => {
  test("fallback matches look evaluations to each video", () => {
    const result = fallbackAssignments([
      unit("u1", "Explore campus life and outdoor student spaces"),
      unit("u2", "Research in science laboratory facilities"),
    ], looks);
    expect(result.map((item) => item.lookId)).toEqual(["campus", "lab"]);
  });

  test("fallback allows repeated looks when content strongly matches", () => {
    const result = fallbackAssignments([
      unit("u1", "Outdoor campus and student experience"),
      unit("u2", "Campus life across outdoor university spaces"),
    ], looks);
    expect(result.map((item) => item.lookId)).toEqual(["campus", "campus"]);
  });

  test("strict validation rejects partial and invented assignments", () => {
    const units = [unit("u1", "campus"), unit("u2", "lab")];
    expect(
      validateAssignments(
        [{ unitId: "u1", lookId: "campus", reason: "match" }],
        units,
        looks
      )
    ).toContain("expected 2");
    expect(
      validateAssignments(
        [
          { unitId: "u1", lookId: "invented", reason: "match" },
          { unitId: "u2", lookId: "lab", reason: "match" },
        ],
        units,
        looks
      )
    ).toContain("unknown lookId");
  });
});
