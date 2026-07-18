import { describe, expect, test } from "vitest";
import { phaseIndexForRunState } from "../run-state-presentation";

describe("phaseIndexForRunState", () => {
  test("keeps avatar generation in the media and preview phase", () => {
    expect(phaseIndexForRunState("GENERATING_AVATAR")).toBe(3);
  });

  test("does not present unknown or terminal states as an active phase", () => {
    expect(phaseIndexForRunState("FAILED")).toBeNull();
    expect(phaseIndexForRunState("UNKNOWN_STATE")).toBeNull();
  });
});
