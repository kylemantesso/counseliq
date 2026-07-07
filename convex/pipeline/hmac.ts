/**
 * HMAC-SHA256 signing/verification over raw request bodies, using Web
 * Crypto so it runs in the default Convex runtime (http actions, actions).
 * Mirrors services/converter/src/hmac.ts — same header, same scheme.
 */

export const SIGNATURE_HEADER = "x-converter-signature";

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export async function hmacSha256Hex(
  body: string,
  secret: string
): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish comparison; length mismatch fails immediately. */
export async function verifyHmacHex(
  body: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;
  const expected = await hmacSha256Hex(body, secret);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
