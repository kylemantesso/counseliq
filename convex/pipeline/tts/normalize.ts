/**
 * Deterministic narration normalisation for speech (GENERATING_SCRIPT).
 * Pure functions over strings — no Convex, no LLM, no node builtins — so the
 * pass is unit-testable and byte-for-byte reproducible. The stored narration
 * stays human-readable; this module produces the parallel `speakText` plus a
 * character-level alignment so edits and card beat anchors round-trip.
 *
 * Architecture: tokenize → ordered matchers (longest match, first wins) →
 * en-AU expanders → recompose with full-coverage alignment segments.
 */

export const NORMALIZER_VERSION = "normalize@1";

/**
 * Maps a span of the original sentence to a span of the normalised
 * `speakText`. `copy` segments are verbatim (identity content); `expand`
 * segments are rewritten (a whole original span maps to a whole normalised
 * span). Segments jointly cover both strings with no gaps or overlaps.
 * Mirrors `scriptAlignmentSegmentSchema` in @counseliq/course-schema.
 */
export interface AlignmentSegment {
  origStart: number;
  origEnd: number;
  normStart: number;
  normEnd: number;
  kind: "copy" | "expand";
}

export interface NormalizedSentence {
  speakText: string;
  alignment: AlignmentSegment[];
}

// --- Tokenizer ---

type TokenType = "word" | "number" | "symbol" | "space" | "punct";

interface Token {
  type: TokenType;
  text: string;
  start: number;
  end: number;
}

const NUMBER_RE = /^\d+(?:,\d{3})*(?:\.\d+)?/;
const WORD_RE = /^[A-Za-z]+(?:['’][A-Za-z]+)*/;
const SPACE_RE = /^\s+/;
const SYMBOL_CHARS = new Set(["$", "%", "+", "–", "—", "-", "/"]);

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let match = NUMBER_RE.exec(rest);
    if (match) {
      tokens.push({ type: "number", text: match[0], start: i, end: i + match[0].length });
      i += match[0].length;
      continue;
    }
    match = WORD_RE.exec(rest);
    if (match) {
      tokens.push({ type: "word", text: match[0], start: i, end: i + match[0].length });
      i += match[0].length;
      continue;
    }
    match = SPACE_RE.exec(rest);
    if (match) {
      tokens.push({ type: "space", text: match[0], start: i, end: i + match[0].length });
      i += match[0].length;
      continue;
    }
    const ch = text[i];
    tokens.push({
      type: SYMBOL_CHARS.has(ch) ? "symbol" : "punct",
      text: ch,
      start: i,
      end: i + 1,
    });
    i += 1;
  }
  return tokens;
}

// --- Number words (en-AU: "one hundred and five") ---

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
  "eighty", "ninety",
];

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const units = n % 10;
  return units === 0 ? TENS[tens] : `${TENS[tens]}-${ONES[units]}`;
}

function threeDigitWords(n: number): string {
  if (n < 100) return twoDigitWords(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const head = `${ONES[hundreds]} hundred`;
  return rest === 0 ? head : `${head} and ${twoDigitWords(rest)}`;
}

/** Integer to en-AU words, 0..999,999,999,999. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999_999) {
    throw new Error(`numberToWords out of range: ${n}`);
  }
  if (n === 0) return "zero";
  const parts: string[] = [];
  const scales: Array<[number, string]> = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1_000, "thousand"],
  ];
  let rest = n;
  for (const [scale, name] of scales) {
    if (rest >= scale) {
      parts.push(`${threeDigitWords(Math.floor(rest / scale))} ${name}`);
      rest %= scale;
    }
  }
  if (rest > 0) {
    // British/en-AU "and" before a trailing sub-hundred remainder.
    if (parts.length > 0 && rest < 100) parts.push(`and ${twoDigitWords(rest)}`);
    else parts.push(threeDigitWords(rest));
  }
  return parts.join(" ");
}

/** "1,200" → 1200; "7.2" keeps its fraction for decimal handling. */
function numericValue(tokenText: string): number {
  return Number.parseFloat(tokenText.replace(/,/g, ""));
}

function isIntegerToken(tokenText: string): boolean {
  return !tokenText.includes(".");
}

/** Number token to speech: integers via numberToWords, decimals digit-wise. */
function numberTokenWords(tokenText: string): string {
  const cleaned = tokenText.replace(/,/g, "");
  if (!cleaned.includes(".")) return numberToWords(Number.parseInt(cleaned, 10));
  const [intPart, fracPart] = cleaned.split(".");
  const digits = fracPart
    .split("")
    .map((d) => ONES[Number.parseInt(d, 10)])
    .join(" ");
  return `${numberToWords(Number.parseInt(intPart, 10))} point ${digits}`;
}

/** Years read as spoken: 2035 "twenty thirty-five", 2005 "two thousand and five". */
function yearWords(year: number): string {
  if (year === 2000) return "two thousand";
  if (year > 2000 && year < 2010) return `two thousand and ${ONES[year - 2000]}`;
  const hi = Math.floor(year / 100);
  const lo = year % 100;
  if (lo === 0) return `${twoDigitWords(hi)} hundred`;
  if (lo < 10) return `${twoDigitWords(hi)} oh ${ONES[lo]}`;
  return `${twoDigitWords(hi)} ${twoDigitWords(lo)}`;
}

function isYearToken(tokenText: string): boolean {
  if (!/^\d{4}$/.test(tokenText)) return false;
  const v = Number.parseInt(tokenText, 10);
  return v >= 1900 && v <= 2099;
}

const ORDINAL_IRREGULAR: Record<string, string> = {
  one: "first",
  two: "second",
  three: "third",
  five: "fifth",
  eight: "eighth",
  nine: "ninth",
  twelve: "twelfth",
};

function ordinalWords(n: number): string {
  const cardinal = numberToWords(n);
  // Ordinalise the final word only ("twenty-three" → "twenty-third").
  const hyphenSplit = cardinal.split("-");
  const spaceSplit = hyphenSplit[hyphenSplit.length - 1].split(" ");
  const last = spaceSplit[spaceSplit.length - 1];
  let ordinal: string;
  if (ORDINAL_IRREGULAR[last]) ordinal = ORDINAL_IRREGULAR[last];
  else if (last.endsWith("y")) ordinal = `${last.slice(0, -1)}ieth`;
  else ordinal = `${last}th`;
  spaceSplit[spaceSplit.length - 1] = ordinal;
  hyphenSplit[hyphenSplit.length - 1] = spaceSplit.join(" ");
  return hyphenSplit.join("-");
}

// --- Matchers ---

interface MatchResult {
  /** Number of tokens consumed from the current position. */
  consumed: number;
  expansion: string;
}

type Matcher = (tokens: Token[], i: number) => MatchResult | null;

const MONTHS = new Set([
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
]);

const CURRENCY_SCALES: Record<string, string> = {
  k: "thousand",
  K: "thousand",
  m: "million",
  M: "million",
  b: "billion",
  B: "billion",
  bn: "billion",
  Bn: "billion",
  BN: "billion",
};

const DASHES = new Set(["–", "—", "-"]);

function adjacent(a: Token, b: Token): boolean {
  return a.end === b.start;
}

function skipSpace(tokens: Token[], i: number): number {
  return tokens[i]?.type === "space" ? i + 1 : i;
}

/** `A$82M`, `$1.5bn`, `AUD 300k` → "eighty-two million Australian dollars"… */
const matchCurrency: Matcher = (tokens, i) => {
  const t = tokens[i];
  let numIdx: number;
  let australian: boolean;
  if (t.type === "word" && t.text === "AUD") {
    numIdx = skipSpace(tokens, i + 1);
    australian = true;
  } else if (
    t.type === "word" &&
    t.text === "A" &&
    tokens[i + 1]?.text === "$" &&
    adjacent(t, tokens[i + 1])
  ) {
    numIdx = skipSpace(tokens, i + 2);
    australian = true;
  } else if (t.type === "symbol" && t.text === "$") {
    numIdx = skipSpace(tokens, i + 1);
    australian = false;
  } else {
    return null;
  }
  const num = tokens[numIdx];
  if (num?.type !== "number") return null;
  let consumedEnd = numIdx + 1;
  let scale = "";
  const suffix = tokens[numIdx + 1];
  if (
    suffix?.type === "word" &&
    adjacent(num, suffix) &&
    CURRENCY_SCALES[suffix.text] !== undefined
  ) {
    scale = ` ${CURRENCY_SCALES[suffix.text]}`;
    consumedEnd = numIdx + 2;
  }
  const unit = australian ? "Australian dollars" : "dollars";
  return {
    consumed: consumedEnd - i,
    expansion: `${numberTokenWords(num.text)}${scale} ${unit}`,
  };
};

/** `12.5%` → "twelve point five per cent" (en-AU spelling). */
const matchPercentage: Matcher = (tokens, i) => {
  const num = tokens[i];
  if (num.type !== "number") return null;
  const pctIdx = skipSpace(tokens, i + 1);
  const pct = tokens[pctIdx];
  if (pct?.type !== "symbol" || pct.text !== "%") return null;
  return { consumed: pctIdx + 1 - i, expansion: `${numberTokenWords(num.text)} per cent` };
};

/** `2019–2023`, `10-15` → "… to …", each end year-aware. */
const matchNumericRange: Matcher = (tokens, i) => {
  const a = tokens[i];
  if (a.type !== "number") return null;
  const dashIdx = skipSpace(tokens, i + 1);
  const dash = tokens[dashIdx];
  if (dash?.type !== "symbol" || !DASHES.has(dash.text)) return null;
  const bIdx = skipSpace(tokens, dashIdx + 1);
  const b = tokens[bIdx];
  if (b?.type !== "number") return null;
  const speak = (t: Token) =>
    isYearToken(t.text) ? yearWords(Number.parseInt(t.text, 10)) : numberTokenWords(t.text);
  return { consumed: bIdx + 1 - i, expansion: `${speak(a)} to ${speak(b)}` };
};

/** `3 March 2024` → "the third of March twenty twenty-four". */
const matchDate: Matcher = (tokens, i) => {
  const day = tokens[i];
  if (day.type !== "number" || !isIntegerToken(day.text) || day.text.includes(","))
    return null;
  const dayValue = Number.parseInt(day.text, 10);
  if (dayValue < 1 || dayValue > 31 || day.text.length > 2) return null;
  const monthIdx = skipSpace(tokens, i + 1);
  const month = tokens[monthIdx];
  if (month?.type !== "word" || !MONTHS.has(month.text)) return null;
  let consumedEnd = monthIdx + 1;
  let yearPart = "";
  const yearIdx = skipSpace(tokens, monthIdx + 1);
  const year = tokens[yearIdx];
  if (year?.type === "number" && isYearToken(year.text)) {
    yearPart = ` ${yearWords(Number.parseInt(year.text, 10))}`;
    consumedEnd = yearIdx + 1;
  }
  return {
    consumed: consumedEnd - i,
    expansion: `the ${ordinalWords(dayValue)} of ${month.text}${yearPart}`,
  };
};

/** `3rd` → "third". */
const matchOrdinal: Matcher = (tokens, i) => {
  const num = tokens[i];
  if (num.type !== "number" || !isIntegerToken(num.text)) return null;
  const suffix = tokens[i + 1];
  if (suffix?.type !== "word" || !adjacent(num, suffix)) return null;
  if (!["st", "nd", "rd", "th"].includes(suffix.text.toLowerCase())) return null;
  return { consumed: 2, expansion: ordinalWords(numericValue(num.text)) };
};

/** `70,000+` → "more than seventy thousand". */
const matchTrailingPlus: Matcher = (tokens, i) => {
  const num = tokens[i];
  if (num.type !== "number") return null;
  const plus = tokens[i + 1];
  if (plus?.type !== "symbol" || plus.text !== "+" || !adjacent(num, plus)) return null;
  return { consumed: 2, expansion: `more than ${numberTokenWords(num.text)}` };
};

/** `COVID-19` → "COVID nineteen". */
const matchAlphanumHyphenNumber: Matcher = (tokens, i) => {
  const word = tokens[i];
  if (word.type !== "word") return null;
  const dash = tokens[i + 1];
  if (dash?.type !== "symbol" || dash.text !== "-" || !adjacent(word, dash)) return null;
  const num = tokens[i + 2];
  if (num?.type !== "number" || !adjacent(dash, num)) return null;
  return { consumed: 3, expansion: `${word.text} ${numberTokenWords(num.text)}` };
};

/** Standalone `2035` (1900–2099, exactly four digits) → "twenty thirty-five". */
const matchYear: Matcher = (tokens, i) => {
  const t = tokens[i];
  if (t.type !== "number" || !isYearToken(t.text)) return null;
  return { consumed: 1, expansion: yearWords(Number.parseInt(t.text, 10)) };
};

/** Any remaining number: `1,200` → "one thousand two hundred", `7.2` decimal. */
const matchNumberFallback: Matcher = (tokens, i) => {
  const t = tokens[i];
  if (t.type !== "number") return null;
  return { consumed: 1, expansion: numberTokenWords(t.text) };
};

/**
 * First-wins order. Ordinal precedes year so "2035th" never reads as a year;
 * date precedes year so the year inside a full date is consumed with it.
 */
const MATCHERS: Matcher[] = [
  matchCurrency,
  matchPercentage,
  matchNumericRange,
  matchDate,
  matchOrdinal,
  matchTrailingPlus,
  matchAlphanumHyphenNumber,
  matchYear,
  matchNumberFallback,
];

// --- Recomposition ---

export function normalizeSentence(text: string): NormalizedSentence {
  const tokens = tokenize(text);
  const alignment: AlignmentSegment[] = [];
  let speakText = "";

  const pushCopy = (start: number, end: number, content: string) => {
    const last = alignment[alignment.length - 1];
    if (last && last.kind === "copy" && last.origEnd === start) {
      last.origEnd = end;
      last.normEnd += content.length;
    } else {
      alignment.push({
        origStart: start,
        origEnd: end,
        normStart: speakText.length,
        normEnd: speakText.length + content.length,
        kind: "copy",
      });
    }
    speakText += content;
  };

  let i = 0;
  while (i < tokens.length) {
    let matched: MatchResult | null = null;
    for (const matcher of MATCHERS) {
      matched = matcher(tokens, i);
      if (matched) break;
    }
    if (matched) {
      const origStart = tokens[i].start;
      const origEnd = tokens[i + matched.consumed - 1].end;
      alignment.push({
        origStart,
        origEnd,
        normStart: speakText.length,
        normEnd: speakText.length + matched.expansion.length,
        kind: "expand",
      });
      speakText += matched.expansion;
      i += matched.consumed;
    } else {
      const t = tokens[i];
      pushCopy(t.start, t.end, t.text);
      i += 1;
    }
  }

  return { speakText, alignment };
}
