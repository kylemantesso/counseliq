import { createHash } from "node:crypto";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Content-addressed object key: sha256/<hash>.<ext>. */
export function contentAddressedKey(bytes: Uint8Array, ext: string): string {
  const normalizedExt = ext.replace(/^\./, "").toLowerCase();
  return `sha256/${sha256Hex(bytes)}.${normalizedExt}`;
}
