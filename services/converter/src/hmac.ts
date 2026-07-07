import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-converter-signature";

/** HMAC-SHA256 hex signature over the raw request body. */
export function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function verifySignature(
  body: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = signBody(body, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
