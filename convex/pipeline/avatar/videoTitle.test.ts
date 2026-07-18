import { describe, expect, test } from "vitest";
import { heyGenAudioFilename, heyGenVideoTitle } from "./videoTitle";

describe("HeyGen video naming", () => {
  test("groups searchable titles by course and short run id", () => {
    const title = heyGenVideoTitle({
      courseTitle: "La Trobe University: Credentialing for Education Counsellors",
      runId: "m178zvjyzkbftr3v7dkgbdb1th8afyyh",
      unitKey: "mu-203",
      unitTitle: "finance",
    });
    expect(title).toBe(
      "La Trobe University: Credentialing for Education Counsellors · th8afyyh · 2.3 finance"
    );
    expect(heyGenAudioFilename(title)).toBe(
      "La-Trobe-University-Credentialing-for-Education-Counsellors-th8afyyh-2.3-finance.mp3"
    );
  });
});
