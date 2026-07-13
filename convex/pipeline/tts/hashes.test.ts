import { describe, expect, test } from "vitest";
import { sanitizeCardsForAudioHash, unitContentHash } from "./hashes";

/**
 * The gate-2 asset-swap guarantee: which cleared asset fills a frame is
 * visual-only and must never invalidate a unit's audio fingerprint, while
 * every audio-relevant input (text, enterAt, template order) still does.
 */

const BASE_INPUT = {
  speakTexts: ["First sentence.", "Second sentence."],
  lexicon: { Bundoora: "bun-DOOR-ah" },
  voiceId: "v1",
  model: "mock-tts-1",
  outputFormat: "mp3_44100_128",
  gapMs: 250,
};

function cards(assetRef: string) {
  return [
    {
      template: "video-card",
      props: { assetRef, overlayText: "Simulation wards" },
      enterAt: { narration: "n1", word: "First" },
    },
    {
      template: "photo-kenburns",
      props: { imageRef: "legacy-ref", overlayText: "Campus" },
      enterAt: { narration: "n2", word: "Second" },
    },
  ];
}

describe("sanitizeCardsForAudioHash", () => {
  test("strips assetRef and imageRef, keeps everything else", () => {
    expect(sanitizeCardsForAudioHash(cards("asset-a"))).toEqual([
      {
        template: "video-card",
        props: { overlayText: "Simulation wards" },
        enterAt: { narration: "n1", word: "First" },
      },
      {
        template: "photo-kenburns",
        props: { overlayText: "Campus" },
        enterAt: { narration: "n2", word: "Second" },
      },
    ]);
  });

  test("passes through non-card shapes untouched", () => {
    expect(sanitizeCardsForAudioHash(undefined)).toBeUndefined();
    expect(sanitizeCardsForAudioHash([null, "x", 7])).toEqual([null, "x", 7]);
    expect(sanitizeCardsForAudioHash([{ template: "text-card" }])).toEqual([
      { template: "text-card" },
    ]);
  });
});

describe("unitContentHash", () => {
  test("asset swap does not change the hash", async () => {
    const before = await unitContentHash({ ...BASE_INPUT, cards: cards("asset-a") });
    const after = await unitContentHash({ ...BASE_INPUT, cards: cards("asset-b") });
    expect(after).toBe(before);
  });

  test("audio-relevant card changes still change the hash", async () => {
    const base = await unitContentHash({ ...BASE_INPUT, cards: cards("asset-a") });
    const moved = cards("asset-a");
    moved[0].enterAt.word = "sentence.";
    expect(await unitContentHash({ ...BASE_INPUT, cards: moved })).not.toBe(base);

    const retexted = cards("asset-a");
    retexted[0].props.overlayText = "Different overlay";
    expect(await unitContentHash({ ...BASE_INPUT, cards: retexted })).not.toBe(
      base
    );
  });

  test("narration and voice changes change the hash", async () => {
    const base = await unitContentHash({ ...BASE_INPUT, cards: cards("a") });
    expect(
      await unitContentHash({
        ...BASE_INPUT,
        speakTexts: ["First sentence.", "Edited sentence."],
        cards: cards("a"),
      })
    ).not.toBe(base);
    expect(
      await unitContentHash({ ...BASE_INPUT, voiceId: "v2", cards: cards("a") })
    ).not.toBe(base);
  });

  test("voice settings change the hash", async () => {
    const base = await unitContentHash({ ...BASE_INPUT, cards: cards("a") });
    expect(
      await unitContentHash({
        ...BASE_INPUT,
        voiceSettings: { speed: 1.1, stability: 0.55 },
        cards: cards("a"),
      })
    ).not.toBe(base);
  });

  test("voice accent changes the hash", async () => {
    const base = await unitContentHash({ ...BASE_INPUT, cards: cards("a") });
    expect(
      await unitContentHash({
        ...BASE_INPUT,
        voiceAccent: "australian",
        cards: cards("a"),
      })
    ).not.toBe(base);
  });
});
