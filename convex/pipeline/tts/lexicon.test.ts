import { describe, expect, test } from "vitest";
import {
  LEXICON_SENTINEL,
  buildSubstitutionMap,
  findBlockedTerms,
  projectSpan,
  substitutionToSpans,
  alignmentToSpans,
  type SpanSegment,
} from "./lexicon";
import { normalizeSentence } from "./normalize";

const LEXICON: Record<string, string> = {
  Bundoora: "bun-DOOR-ah",
  "Albury-Wodonga": "AWL-bree wuh-DONG-ga",
  ACAMI: "ah-KAH-mee",
  BioNTech: "BY-on-tek",
  Thanthiriwattage: LEXICON_SENTINEL,
};

describe("buildSubstitutionMap", () => {
  test("substitutes a single term with span mapping", () => {
    const { spokenText, segments } = buildSubstitutionMap(
      "Welcome to Bundoora today",
      LEXICON,
    );
    expect(spokenText).toBe("Welcome to bun-DOOR-ah today");
    expect(segments).toEqual([
      { normStart: 0, normEnd: 11, spokenStart: 0, spokenEnd: 11, kind: "copy" },
      { normStart: 11, normEnd: 19, spokenStart: 11, spokenEnd: 22, kind: "expand" },
      { normStart: 19, normEnd: 25, spokenStart: 22, spokenEnd: 28, kind: "copy" },
    ]);
  });

  test("multi-word key becomes a single expand segment", () => {
    const { spokenText, segments } = buildSubstitutionMap(
      "the Albury-Wodonga campus",
      LEXICON,
    );
    expect(spokenText).toBe("the AWL-bree wuh-DONG-ga campus");
    const expands = segments.filter((s) => s.kind === "expand");
    expect(expands).toHaveLength(1);
    expect(expands[0].normEnd - expands[0].normStart).toBe("Albury-Wodonga".length);
  });

  test("overlapping keys resolve longest-first", () => {
    const lexicon = { Alb: "short", "Albury-Wodonga": "AWL-bree wuh-DONG-ga" };
    const { spokenText } = buildSubstitutionMap("Albury-Wodonga", lexicon);
    expect(spokenText).toBe("AWL-bree wuh-DONG-ga");
  });

  test("word boundaries respected — no substitution inside larger words", () => {
    const { spokenText } = buildSubstitutionMap("the MACAMIX system", LEXICON);
    expect(spokenText).toBe("the MACAMIX system");
  });

  test("sentinel-valued keys are left verbatim", () => {
    const { spokenText, segments } = buildSubstitutionMap(
      "Professor Thanthiriwattage leads the lab",
      LEXICON,
    );
    expect(spokenText).toBe("Professor Thanthiriwattage leads the lab");
    expect(segments.every((s) => s.kind === "copy")).toBe(true);
  });

  test("multiple occurrences all substitute", () => {
    const { spokenText } = buildSubstitutionMap("Bundoora and Bundoora", LEXICON);
    expect(spokenText).toBe("bun-DOOR-ah and bun-DOOR-ah");
  });

  test("empty lexicon is identity", () => {
    const { spokenText, segments } = buildSubstitutionMap("plain text", {});
    expect(spokenText).toBe("plain text");
    expect(segments).toEqual([
      { normStart: 0, normEnd: 10, spokenStart: 0, spokenEnd: 10, kind: "copy" },
    ]);
  });
});

describe("findBlockedTerms", () => {
  test("finds sentinel terms present in text", () => {
    expect(
      findBlockedTerms("Professor Thanthiriwattage leads the lab", LEXICON),
    ).toEqual(["Thanthiriwattage"]);
  });

  test("resolved terms never block", () => {
    expect(findBlockedTerms("Welcome to Bundoora", LEXICON)).toEqual([]);
  });

  test("word boundary — sentinel key inside a larger word does not block", () => {
    expect(findBlockedTerms("XThanthiriwattageY", LEXICON)).toEqual([]);
  });

  test("empty lexicon blocks nothing", () => {
    expect(findBlockedTerms("anything at all", {})).toEqual([]);
  });
});

describe("projectSpan", () => {
  const segments: SpanSegment[] = [
    { inStart: 0, inEnd: 10, outStart: 0, outEnd: 10, kind: "copy" },
    { inStart: 10, inEnd: 15, outStart: 10, outEnd: 22, kind: "expand" },
    { inStart: 15, inEnd: 25, outStart: 22, outEnd: 32, kind: "copy" },
  ];

  test("span inside a copy segment maps identically offset", () => {
    expect(projectSpan(segments, [2, 6])).toEqual([2, 6]);
    expect(projectSpan(segments, [17, 20])).toEqual([24, 27]);
  });

  test("span inside an expand segment claims the whole output span", () => {
    expect(projectSpan(segments, [11, 13])).toEqual([10, 22]);
  });

  test("span straddling a boundary unions both projections", () => {
    expect(projectSpan(segments, [8, 12])).toEqual([8, 22]);
    expect(projectSpan(segments, [12, 18])).toEqual([10, 25]);
  });

  test("span touching no segment projects to a zero-length span", () => {
    const sparse: SpanSegment[] = [
      { inStart: 10, inEnd: 20, outStart: 0, outEnd: 10, kind: "copy" },
    ];
    expect(projectSpan(sparse, [0, 5])).toEqual([0, 0]);
    expect(projectSpan(sparse, [25, 30])).toEqual([10, 10]);
  });

  test("chains original → speakText → spokenText across both mappings", () => {
    const original = "Opened in 2005 at Bundoora";
    const { speakText, alignment } = normalizeSentence(original);
    expect(speakText).toBe("Opened in two thousand and five at Bundoora");
    const substitution = buildSubstitutionMap(speakText, LEXICON);
    expect(substitution.spokenText).toBe(
      "Opened in two thousand and five at bun-DOOR-ah",
    );
    // "Bundoora" in the original → its span in speakText → respelled span.
    const origSpan: [number, number] = [
      original.indexOf("Bundoora"),
      original.indexOf("Bundoora") + "Bundoora".length,
    ];
    const normSpan = projectSpan(alignmentToSpans(alignment), origSpan);
    expect(speakText.slice(normSpan[0], normSpan[1])).toBe("Bundoora");
    const spokenSpan = projectSpan(substitutionToSpans(substitution.segments), normSpan);
    expect(substitution.spokenText.slice(spokenSpan[0], spokenSpan[1])).toBe(
      "bun-DOOR-ah",
    );
  });
});
