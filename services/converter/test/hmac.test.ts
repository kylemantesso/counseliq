import { describe, expect, it } from "vitest";
import { signBody, verifySignature } from "../src/hmac";

describe("hmac sign/verify", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ jobId: "job-1", hello: "world" });

  it("round-trips", () => {
    const signature = signBody(body, secret);
    expect(verifySignature(body, signature, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = signBody(body, secret);
    expect(verifySignature(body + " ", signature, secret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const signature = signBody(body, "other-secret");
    expect(verifySignature(body, signature, secret)).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    expect(verifySignature(body, "zzz", secret)).toBe(false);
  });
});
