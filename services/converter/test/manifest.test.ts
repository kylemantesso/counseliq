import { describe, expect, it } from "vitest";
import { buildManifest } from "../src/convert";

const HASH = "d".repeat(64);
const KEY_A = `sha256/${"e".repeat(64)}.png`;
const KEY_B = `sha256/${"f".repeat(64)}.png`;

describe("buildManifest", () => {
  it("assembles a manifest that satisfies the shared contract", () => {
    const manifest = buildManifest({
      sourceDocHash: HASH,
      theme: {
        colors: ["#112233"],
        fonts: ["Calibri"],
        logoCandidates: [KEY_A],
      },
      pages: [
        {
          n: 1,
          pngKey: KEY_A,
          thumbKey: KEY_B,
          text: "Page one",
          notes: "Notes",
          embeddedImages: [{ key: KEY_B, width: 100, height: 50 }],
        },
      ],
    });
    expect(manifest.pageCount).toBe(1);
    expect(manifest.pages[0].n).toBe(1);
  });

  it("throws when an object key violates the contract", () => {
    expect(() =>
      buildManifest({
        sourceDocHash: HASH,
        theme: null,
        pages: [
          {
            n: 1,
            pngKey: "pages/1.png",
            thumbKey: KEY_B,
            text: "",
            notes: "",
            embeddedImages: [],
          },
        ],
      })
    ).toThrow();
  });

  it("throws on a malformed sourceDocHash", () => {
    expect(() =>
      buildManifest({ sourceDocHash: "nope", theme: null, pages: [] })
    ).toThrow();
  });
});
