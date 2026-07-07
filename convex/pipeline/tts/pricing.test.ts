import { describe, expect, test } from "vitest";
import { estimateTtsCostUsd, TTS_PRICING } from "./pricing";

describe("estimateTtsCostUsd", () => {
  test("multilingual v2 at $0.10 per 1k characters", () => {
    expect(
      estimateTtsCostUsd({ model: "eleven_multilingual_v2", characters: 25_000 })
    ).toBeCloseTo(2.5);
  });

  test("flash is half the multilingual rate", () => {
    const flash = estimateTtsCostUsd({
      model: "eleven_flash_v2_5",
      characters: 10_000,
    });
    const quality = estimateTtsCostUsd({
      model: "eleven_multilingual_v2",
      characters: 10_000,
    });
    expect(flash).toBeCloseTo(quality! / 2);
  });

  test("unknown models return null, mock is free", () => {
    expect(estimateTtsCostUsd({ model: "who-knows", characters: 100 })).toBeNull();
    expect(estimateTtsCostUsd({ model: "mock-tts-1", characters: 100 })).toBe(0);
  });

  test("every price entry carries a verification date", () => {
    for (const entry of Object.values(TTS_PRICING)) {
      expect(entry.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
