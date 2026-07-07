/**
 * Width-aware display-text sizing. Card columns are 300px (360 − 2×30
 * padding) and display glyphs run ~0.58em wide, so a fixed mockup font
 * size overflows the moment the compiler writes a longer word than the
 * mockup's sample ("Acknowledgement" at title size bleeds off the card).
 *
 * The constraint is the LONGEST WORD: wrapping handles everything else.
 * Callers pair this with `overflowWrap: "break-word"` as the backstop for
 * words too long even at the floor size.
 */

const COLUMN_PX = 300;
const GLYPH_EM = 0.58;

export interface FitOptions {
  /** Smallest acceptable size; below this, break-word takes over. */
  minPx?: number;
  /** Available column width in design px (default 300). */
  columnPx?: number;
  /** Average glyph width as a fraction of the font size (default 0.58). */
  glyphEm?: number;
}

export function fitDisplayFontSize(
  text: string | null | undefined,
  maxPx: number,
  options: FitOptions = {}
): number {
  const { minPx = 22, columnPx = COLUMN_PX, glyphEm = GLYPH_EM } = options;
  const longestWord = String(text ?? "")
    .split(/\s+/)
    .reduce((max, word) => Math.max(max, word.length), 0);
  if (longestWord === 0) return maxPx;
  const sizeByWord = Math.floor(columnPx / (glyphEm * longestWord));
  return Math.max(minPx, Math.min(maxPx, sizeByWord));
}
