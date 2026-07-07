import { describe, expect, it } from "vitest";
import { contentAddressedKeySchema } from "@counseliq/course-schema";
import { contentAddressedKey, sha256Hex } from "../src/content-address";

describe("content addressing", () => {
  it("produces keys matching the shared contract pattern", () => {
    const key = contentAddressedKey(Buffer.from("hello"), "png");
    expect(contentAddressedKeySchema.safeParse(key).success).toBe(true);
  });

  it("is deterministic for identical bytes", () => {
    const a = contentAddressedKey(Buffer.from("same"), "png");
    const b = contentAddressedKey(Buffer.from("same"), "png");
    expect(a).toBe(b);
  });

  it("differs for different bytes", () => {
    const a = contentAddressedKey(Buffer.from("one"), "png");
    const b = contentAddressedKey(Buffer.from("two"), "png");
    expect(a).not.toBe(b);
  });

  it("normalizes extension case and leading dot", () => {
    const bytes = Buffer.from("x");
    expect(contentAddressedKey(bytes, ".PNG")).toBe(
      `sha256/${sha256Hex(bytes)}.png`
    );
  });
});
