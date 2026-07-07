/**
 * Source labels worth SHOWING. The compiler writes provenance-class
 * markers like "Institution claim" as sourceLabels for statements drawn
 * from the institution's own materials — meaningful for QA, noise on a
 * rendered card. Real citations (ranking bodies, reports, years) render;
 * class markers don't. The props are untouched — compliance checks read
 * them, not the pixels.
 */

const HIDDEN_LABELS = new Set(["institution claim", "institution claims"]);

export function visibleSourceLabels(
  ...values: Array<string | null | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const label = value.trim();
    if (label.length === 0) continue;
    if (HIDDEN_LABELS.has(label.toLowerCase())) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}
