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

export interface BlockFitOptions extends FitOptions {
  /** Vertical budget for the wrapped block in design px. */
  maxHeightPx: number;
  /** Line height multiplier the caller renders with (default 1.3). */
  lineHeight?: number;
}

/** Greedy word-wrap line count at a given font size, using the same
 * average-glyph estimate as the width fit. */
function wrappedLineCount(
  words: string[],
  fontPx: number,
  columnPx: number,
  glyphEm: number
): number {
  const capacity = columnPx / (glyphEm * fontPx);
  let lines = 1;
  let current = 0;
  for (const word of words) {
    const needed = current > 0 ? word.length + 1 : word.length;
    if (current > 0 && current + needed > capacity) {
      lines += 1;
      current = word.length;
    } else {
      current += needed;
    }
  }
  return lines;
}

/**
 * Width- AND height-aware sizing for multi-line display blocks (takeaway
 * statements, alert messages, pull quotes). `fitDisplayFontSize` only
 * guards the longest word — a 40-word takeaway wraps fine horizontally
 * but runs straight off the bottom of the card. This variant additionally
 * shrinks until the estimated wrapped height (greedy word wrap at the
 * caller's line height) fits `maxHeightPx`. The floor is lower (18px)
 * because a floor-size block that still overflows has nowhere to go.
 */
export function fitBlockFontSize(
  text: string | null | undefined,
  maxPx: number,
  options: BlockFitOptions
): number {
  const {
    minPx = 18,
    columnPx = COLUMN_PX,
    glyphEm = GLYPH_EM,
    lineHeight = 1.3,
    maxHeightPx,
  } = options;
  const words = String(text ?? "")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return maxPx;
  const start = fitDisplayFontSize(text, maxPx, { minPx, columnPx, glyphEm });
  for (let size = start; size > minPx; size--) {
    const lines = wrappedLineCount(words, size, columnPx, glyphEm);
    if (lines * size * lineHeight <= maxHeightPx) return size;
  }
  return minPx;
}
