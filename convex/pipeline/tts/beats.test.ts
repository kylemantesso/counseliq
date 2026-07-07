import { describe, expect, test } from "vitest";
import { unitScriptSchema, type UnitScript } from "@counseliq/course-schema";
import {
  assembleUnitClock,
  buildUnitTiming,
  deriveWords,
  projectWordsToSpeakText,
  resolveCardBeats,
  tokenizeWords,
  type SentenceForAssembly,
} from "./beats";
import { buildSubstitutionMap } from "./lexicon";
import { createMockTtsProvider } from "./mock";
import { normalizeSentence, NORMALIZER_VERSION } from "./normalize";

const LEXICON = { Bundoora: "bun-DOOR-ah" };

/**
 * Realistic end-of-pipe fixture: normalise a sentence, substitute the
 * lexicon, synthesise with the mock (50ms/char), derive words.
 */
async function synthesizeSentence(narrationId: string, sourceText: string) {
  const { speakText, alignment } = normalizeSentence(sourceText);
  const substitution = buildSubstitutionMap(speakText, LEXICON);
  const provider = createMockTtsProvider();
  const result = await provider.synthesize({
    text: substitution.spokenText,
    voiceId: "v1",
  });
  const spokenWords = deriveWords(substitution.spokenText, result.timestamps);
  const words = projectWordsToSpeakText(
    speakText,
    substitution.segments,
    spokenWords
  );
  return {
    scriptSentence: {
      narrationId,
      sourceText,
      speakText,
      alignment,
      blockedTerms: [],
    },
    assembly: {
      narrationId,
      speakText,
      audioKey: `sha256/fake-${narrationId}.mp3`,
      durationMs: Math.round(substitution.spokenText.length * 50),
      words,
    } satisfies SentenceForAssembly,
  };
}

function scriptOf(sentences: UnitScript["sentences"]): UnitScript {
  return unitScriptSchema.parse({
    version: 1,
    normalizerVersion: NORMALIZER_VERSION,
    sentences,
    generatedAt: 1,
  });
}

describe("tokenizeWords / deriveWords", () => {
  test("word char ranges map to first/last character times", async () => {
    const provider = createMockTtsProvider();
    const text = "Hello brave world";
    const result = await provider.synthesize({ text, voiceId: "v1" });
    const words = deriveWords(text, result.timestamps);

    expect(words.map((w) => w.text)).toEqual(["Hello", "brave", "world"]);
    // "Hello" = chars [0,5): starts at 0ms, ends at 5*50 = 250ms.
    expect(words[0]).toMatchObject({ startMs: 0, endMs: 250, charStart: 0, charEnd: 5 });
    // "brave" = chars [6,11): 300ms..550ms.
    expect(words[1]).toMatchObject({ startMs: 300, endMs: 550 });
  });

  test("tokenizeWords handles leading/multiple whitespace", () => {
    expect(tokenizeWords("  a  bc ")).toEqual([
      { text: "a", start: 2, end: 3 },
      { text: "bc", start: 5, end: 7 },
    ]);
  });
});

describe("projectWordsToSpeakText", () => {
  test("words inside a lexicon expansion share the expansion's time range", async () => {
    const { assembly } = await synthesizeSentence(
      "n1",
      "Visit the Bundoora campus today."
    );
    const bundoora = assembly.words.find((w) => w.text === "Bundoora");
    const visit = assembly.words.find((w) => w.text === "Visit");
    expect(bundoora).toBeDefined();
    expect(visit).toBeDefined();
    // The substituted alias "bun-DOOR-ah" is one spoken word; the speakText
    // word "Bundoora" inherits its full range and stays ordered.
    expect(bundoora!.endMs).toBeGreaterThan(bundoora!.startMs);
    expect(bundoora!.startMs).toBeGreaterThan(visit!.startMs);
  });

  test("copy-only sentences keep 1:1 word times", async () => {
    const { assembly } = await synthesizeSentence("n1", "Plain simple words.");
    expect(assembly.words.map((w) => w.text)).toEqual([
      "Plain",
      "simple",
      "words.",
    ]);
    expect(assembly.words[0].startMs).toBe(0);
    expect(assembly.words[1].startMs).toBeGreaterThan(assembly.words[0].endMs - 1);
  });
});

describe("assembleUnitClock", () => {
  test("sentences accumulate with gaps and words shift onto the unit clock", async () => {
    const first = await synthesizeSentence("n1", "First sentence here.");
    const second = await synthesizeSentence("n2", "Second one.");
    const timing = assembleUnitClock([first.assembly, second.assembly], 250);

    expect(timing[0].startMs).toBe(0);
    expect(timing[1].startMs).toBe(first.assembly.durationMs + 250);
    const firstWordOfSecond = timing[1].words[0];
    expect(firstWordOfSecond.startMs).toBe(timing[1].startMs);
  });
});

describe("resolveCardBeats", () => {
  test("anchor after an expanded number resolves via the alignment chain", async () => {
    // "A$82M" expands to five speakText words; the anchor word "research"
    // comes after it — beat time must reflect the expanded audio, not the
    // original char position.
    const s = await synthesizeSentence(
      "n1",
      "We invested A$82M in research this year."
    );
    const timing = assembleUnitClock([s.assembly], 250);
    const beats = resolveCardBeats(
      [{ enterAt: { narration: "n1", word: "research" } }],
      scriptOf([s.scriptSentence]),
      timing
    );

    const researchWord = timing[0].words.find((w) => w.text === "research");
    expect(beats).toEqual([{ cardIndex: 0, atMs: researchWord!.startMs }]);
    // Sanity: it lands after the expanded currency phrase.
    const dollars = timing[0].words.find((w) => w.text === "dollars");
    expect(researchWord!.startMs).toBeGreaterThan(dollars!.startMs);
  });

  test("anchor word inside a lexicon alias resolves to the alias start", async () => {
    const s = await synthesizeSentence("n2", "Welcome to Bundoora in spring.");
    const timing = assembleUnitClock([s.assembly], 250);
    const beats = resolveCardBeats(
      [{ enterAt: { narration: "n2", word: "Bundoora" } }],
      scriptOf([s.scriptSentence]),
      timing
    );
    const bundoora = timing[0].words.find((w) => w.text === "Bundoora");
    expect(beats[0].atMs).toBe(bundoora!.startMs);
  });

  test("beats land on the unit clock for non-first sentences", async () => {
    const first = await synthesizeSentence("n1", "Opening line.");
    const second = await synthesizeSentence("n2", "The word target is here.");
    const timing = assembleUnitClock([first.assembly, second.assembly], 250);
    const beats = resolveCardBeats(
      [{ enterAt: { narration: "n2", word: "target" } }],
      scriptOf([first.scriptSentence, second.scriptSentence]),
      timing
    );
    expect(beats[0].atMs).toBeGreaterThanOrEqual(timing[1].startMs);
  });

  test("unresolvable anchors fall back to the sentence start", async () => {
    const s = await synthesizeSentence("n1", "Nothing matches here.");
    const timing = assembleUnitClock([s.assembly], 250);
    const beats = resolveCardBeats(
      [
        { enterAt: { narration: "n1", word: "absent" } },
        { enterAt: { narration: "n9", word: "ghost" } },
      ],
      scriptOf([s.scriptSentence]),
      timing
    );
    expect(beats[0]).toEqual({ cardIndex: 0, atMs: timing[0].startMs });
    expect(beats[1]).toEqual({ cardIndex: 1, atMs: 0 });
  });
});

describe("buildUnitTiming", () => {
  test("assembles a schema-valid artifact with computed total duration", async () => {
    const first = await synthesizeSentence("n1", "First sentence here.");
    const second = await synthesizeSentence("n2", "With Bundoora nearby.");
    const timing = assembleUnitClock([first.assembly, second.assembly], 250);
    const beats = resolveCardBeats(
      [{ enterAt: { narration: "n2", word: "Bundoora" } }],
      scriptOf([first.scriptSentence, second.scriptSentence]),
      timing
    );

    const artifact = buildUnitTiming({
      unitKey: "mu-101",
      provider: "mock",
      voiceRef: "test-narrator",
      model: "mock-tts-1",
      gapMs: 250,
      sentences: timing,
      cardBeats: beats,
      generatedAt: 1720000000000,
    });

    expect(artifact.version).toBe(1);
    expect(artifact.totalDurationMs).toBe(
      timing[1].startMs + timing[1].durationMs
    );
    expect(artifact.cardBeats).toHaveLength(1);
  });
});
