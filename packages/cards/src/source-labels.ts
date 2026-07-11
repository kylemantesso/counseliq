/**
 * Source labels worth SHOWING. Rendering keeps any non-empty label and only
 * dedupes case-insensitively.
 */

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function visibleSourceLabels(
  ...values: Array<string | null | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const label = normalizeWhitespace(value);
    if (label.length === 0) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}
