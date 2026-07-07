import { describe, expect, test } from "vitest";
import {
  NORMALIZER_VERSION,
  normalizeSentence,
  numberToWords,
  type AlignmentSegment,
} from "./normalize";

/** The plan's rule table, verbatim. */
const RULE_TABLE: Array<{ input: string; expected: string; rule: string }> = [
  {
    input: "A$82M",
    expected: "eighty-two million Australian dollars",
    rule: "currency (A$ → Australian dollars)",
  },
  {
    input: "$1.5bn",
    expected: "one point five billion dollars",
    rule: "currency + decimal",
  },
  {
    input: "AUD 300k",
    expected: "three hundred thousand Australian dollars",
    rule: "currency",
  },
  { input: "12.5%", expected: "twelve point five per cent", rule: "percentage" },
  {
    input: "70,000+ nurses",
    expected: "more than seventy thousand nurses",
    rule: "trailingPlus + cardinal",
  },
  {
    input: "2019–2023",
    expected: "twenty nineteen to twenty twenty-three",
    rule: "range → year, year",
  },
  { input: "by 2035", expected: "by twenty thirty-five", rule: "year" },
  { input: "in 2005", expected: "in two thousand and five", rule: "year (00s decade)" },
  { input: "3rd", expected: "third", rule: "ordinal" },
  {
    input: "1,200 students",
    expected: "one thousand two hundred students",
    rule: "cardinal (grouping)",
  },
  { input: "Section 7.2", expected: "Section seven point two", rule: "decimal" },
  { input: "COVID-19", expected: "COVID nineteen", rule: "alphanumHyphenNumber" },
  { input: "10-15 minutes", expected: "ten to fifteen minutes", rule: "range → cardinal" },
  {
    input: "3 March 2024",
    expected: "the third of March twenty twenty-four",
    rule: "date",
  },
  {
    input: "Bundoora campus",
    expected: "Bundoora campus",
    rule: "lexicon applies at TTS time, not here",
  },
];

function assertAlignmentInvariants(
  input: string,
  speakText: string,
  alignment: AlignmentSegment[],
) {
  expect(alignment.length).toBeGreaterThan(0);
  // Full coverage of both strings, monotone, no gaps or overlaps.
  expect(alignment[0].origStart).toBe(0);
  expect(alignment[0].normStart).toBe(0);
  expect(alignment[alignment.length - 1].origEnd).toBe(input.length);
  expect(alignment[alignment.length - 1].normEnd).toBe(speakText.length);
  for (let i = 1; i < alignment.length; i++) {
    expect(alignment[i].origStart).toBe(alignment[i - 1].origEnd);
    expect(alignment[i].normStart).toBe(alignment[i - 1].normEnd);
  }
  for (const seg of alignment) {
    expect(seg.origEnd).toBeGreaterThanOrEqual(seg.origStart);
    expect(seg.normEnd).toBeGreaterThanOrEqual(seg.normStart);
    if (seg.kind === "copy") {
      // Copy segments are verbatim.
      expect(speakText.slice(seg.normStart, seg.normEnd)).toBe(
        input.slice(seg.origStart, seg.origEnd),
      );
    }
  }
}

describe("normalizeSentence rule table", () => {
  test.each(RULE_TABLE)("$rule: $input → $expected", ({ input, expected }) => {
    expect(normalizeSentence(input).speakText).toBe(expected);
  });

  test.each(RULE_TABLE)("alignment invariants hold for: $input", ({ input }) => {
    const { speakText, alignment } = normalizeSentence(input);
    assertAlignmentInvariants(input, speakText, alignment);
  });

  test.each(RULE_TABLE)("normalisation is idempotent for: $input", ({ input }) => {
    const once = normalizeSentence(input).speakText;
    expect(normalizeSentence(once).speakText).toBe(once);
  });
});

describe("normalizeSentence composition", () => {
  test("expansions embed mid-sentence with surrounding copy intact", () => {
    const input = "The university invested A$82M across 2019–2023, lifting 12.5% growth.";
    const { speakText, alignment } = normalizeSentence(input);
    expect(speakText).toBe(
      "The university invested eighty-two million Australian dollars across twenty nineteen to twenty twenty-three, lifting twelve point five per cent growth.",
    );
    assertAlignmentInvariants(input, speakText, alignment);
    expect(alignment.filter((s) => s.kind === "expand")).toHaveLength(3);
  });

  test("plain prose is identity with a single copy segment", () => {
    const input = "Bundoora is home to the university's largest campus.";
    const { speakText, alignment } = normalizeSentence(input);
    expect(speakText).toBe(input);
    expect(alignment).toEqual([
      {
        origStart: 0,
        origEnd: input.length,
        normStart: 0,
        normEnd: input.length,
        kind: "copy",
      },
    ]);
  });

  test("date without a year still reads as an ordinal date", () => {
    expect(normalizeSentence("on 21 March we begin").speakText).toBe(
      "on the twenty-first of March we begin",
    );
  });

  test("version tag is stable", () => {
    expect(NORMALIZER_VERSION).toBe("normalize@1");
  });
});

describe("numberToWords", () => {
  test.each([
    [0, "zero"],
    [15, "fifteen"],
    [105, "one hundred and five"],
    [1005, "one thousand and five"],
    [1200, "one thousand two hundred"],
    [82_000_000, "eighty-two million"],
    [
      999_999_999_999,
      "nine hundred and ninety-nine billion nine hundred and ninety-nine million nine hundred and ninety-nine thousand nine hundred and ninety-nine",
    ],
  ])("%d → %s", (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });

  test("rejects out-of-range input", () => {
    expect(() => numberToWords(-1)).toThrow();
    expect(() => numberToWords(1.5)).toThrow();
    expect(() => numberToWords(1_000_000_000_000)).toThrow();
  });
});
