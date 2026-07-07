import { PROVENANCE_ID_PATTERN } from "@counseliq/course-schema";

/**
 * Code-enforced compiler rules — NEVER left to the prompt. Pure functions
 * over plain shapes so they are unit-testable without Convex or an LLM.
 * The compiler rejects mechanically; the judge (different model family)
 * re-checks adversarially.
 */

// --- Banned-claims lexicon ---

export interface BannedClaimHit {
  code: string;
  /** The offending excerpt. */
  excerpt: string;
  description: string;
}

interface BannedClaimPattern {
  code: string;
  pattern: RegExp;
  description: string;
}

/**
 * Migration-outcome promises. Stating current visa settings is legal;
 * promising outcomes (PR, visa grants, guaranteed employment) is misconduct.
 */
const MIGRATION_PROMISE_PATTERNS: BannedClaimPattern[] = [
  {
    code: "migration-outcome-promise",
    pattern:
      /\b(guarantee[sd]?|assur(?:es?|ed)|promis(?:es?|ed))\b[^.!?]{0,60}\b(visa|permanent residency|\bPR\b|migration|residency)/i,
    description: "promises a visa/PR/migration outcome",
  },
  {
    code: "migration-outcome-promise",
    pattern:
      /\b(visa|permanent residency|\bPR\b|migration outcome)[^.!?]{0,40}\b(is|are)\s+(guaranteed|assured|certain|straightforward)\b/i,
    description: "asserts a visa/PR outcome as guaranteed",
  },
  {
    code: "migration-outcome-promise",
    pattern:
      /\b(will|always)\s+(get|receive|obtain|be granted)\b[^.!?]{0,40}\b(a\s+)?(visa|permanent residency|\bPR\b|work rights)/i,
    description: "promises that students will receive a visa/PR/work rights",
  },
  {
    code: "employment-guarantee",
    pattern:
      /\b(guarantee[sd]?|assured?)\b[^.!?]{0,40}\b(job|employment|graduate role|position)\b/i,
    description: "guarantees employment",
  },
  {
    code: "employment-guarantee",
    pattern: /\b(job|employment)\s+(is|are)\s+guaranteed\b/i,
    description: "asserts employment as guaranteed",
  },
];

const SUPERLATIVE_PATTERN =
  /\b(?:the\s+)?(world'?s|australia'?s|nation'?s|country'?s|globe'?s)\s+(first|best|largest|leading|top|greatest|finest|number\s+one)\b/i;

/** Attribution markers that make a superlative legal in the same sentence. */
const ATTRIBUTION_PATTERN =
  /\b(describe[sd]?|described as|according to|claims?|says|states?|calls?|billed as|reports?|institution claim|the university)\b/i;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Scans text for banned claims: migration-outcome promises anywhere, and
 * superlatives ("world's first", "Australia's largest") in sentences that
 * carry no attribution marker.
 */
export function findBannedClaimsInText(text: string): BannedClaimHit[] {
  const hits: BannedClaimHit[] = [];
  for (const { code, pattern, description } of MIGRATION_PROMISE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      hits.push({ code, excerpt: match[0], description });
    }
  }
  for (const sentence of splitSentences(text)) {
    const superlative = sentence.match(SUPERLATIVE_PATTERN);
    if (superlative && !ATTRIBUTION_PATTERN.test(sentence)) {
      hits.push({
        code: "unattributed-superlative",
        excerpt: superlative[0],
        description: "superlative asserted without attribution",
      });
    }
  }
  return hits;
}

// --- Generic-card cap ---

/** Templates counted as "generic" for the cap. */
export const GENERIC_CARD_TEMPLATES: readonly string[] = ["text-card"];

/**
 * Generic-card cap: at most 1 generic card in 3 (per unit), and never two
 * generic cards consecutively. Returns violation messages (empty = ok).
 */
export function validateGenericCardCap(
  cards: Array<{ template: string }>
): string[] {
  const violations: string[] = [];
  const genericFlags = cards.map((card) =>
    GENERIC_CARD_TEMPLATES.includes(card.template)
  );
  const genericCount = genericFlags.filter(Boolean).length;
  const cap = Math.max(1, Math.floor(cards.length / 3));
  if (genericCount > cap) {
    violations.push(
      `${genericCount} generic card(s) in ${cards.length} exceeds the 1-in-3 cap (max ${cap})`
    );
  }
  for (let i = 1; i < genericFlags.length; i++) {
    if (genericFlags[i] && genericFlags[i - 1]) {
      violations.push(`consecutive generic cards at positions ${i} and ${i + 1}`);
      break;
    }
  }
  return violations;
}

// --- Card provenance ---

export const DERIVED_PROVENANCE = "compiler:derived";

/**
 * Every card's provenance must be `compiler:derived` or a `;`-joined list
 * of inventory page-provenance IDs that exist in the run's inventory.
 */
export function validateCardProvenance(
  cards: Array<{ template: string; provenance: string }>,
  knownProvenanceIds: ReadonlySet<string>
): string[] {
  const violations: string[] = [];
  cards.forEach((card, index) => {
    if (card.provenance === DERIVED_PROVENANCE) return;
    const parts = card.provenance.split(";").map((p) => p.trim());
    for (const part of parts) {
      if (!PROVENANCE_ID_PATTERN.test(part)) {
        violations.push(
          `card ${index + 1} (${card.template}): provenance "${part}" is neither "${DERIVED_PROVENANCE}" nor a page provenance ID`
        );
      } else if (!knownProvenanceIds.has(part)) {
        violations.push(
          `card ${index + 1} (${card.template}): provenance "${part}" does not reference any inventory item of this run`
        );
      }
    }
  });
  return violations;
}

// --- Statistic cards must carry a sourceLabel ---

const STAT_CARD_TEMPLATES: readonly string[] = ["stat-card", "chart-card"];

/**
 * Every statistic card must carry a non-empty `sourceLabel` prop — a
 * narrated statistic without attribution is a compliance risk.
 */
export function validateStatisticCardsHaveSource(
  cards: Array<{ template: string; props: Record<string, unknown> }>
): string[] {
  const violations: string[] = [];
  cards.forEach((card, index) => {
    if (!STAT_CARD_TEMPLATES.includes(card.template)) return;
    const sourceLabel = card.props.sourceLabel;
    if (typeof sourceLabel !== "string" || sourceLabel.trim() === "") {
      violations.push(
        `card ${index + 1} (${card.template}) is missing a sourceLabel`
      );
    }
  });
  return violations;
}

// --- Course-level question checks ---

/**
 * Every question's conceptTag must match its unit's concept tag (questions
 * belong to exactly one unit in M4).
 */
export function validateQuestionConceptTags(
  units: Array<{
    unitId: string;
    conceptTag: string;
    questionIds: string[];
  }>,
  questions: Array<{ id: string; conceptTag: string }>
): string[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const violations: string[] = [];
  for (const unit of units) {
    for (const questionId of unit.questionIds) {
      const question = byId.get(questionId);
      if (!question) {
        violations.push(
          `unit ${unit.unitId}: question "${questionId}" not found in the bank`
        );
      } else if (question.conceptTag !== unit.conceptTag) {
        violations.push(
          `unit ${unit.unitId}: question "${questionId}" has conceptTag "${question.conceptTag}", expected "${unit.conceptTag}"`
        );
      }
    }
  }
  return violations;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** No two questions in a course may share an identical prompt. */
export function validateUniqueQuestionPrompts(
  questions: Array<{ id: string; prompt: string }>
): string[] {
  const seen = new Map<string, string>();
  const violations: string[] = [];
  for (const question of questions) {
    const key = normalizeText(question.prompt);
    const existing = seen.get(key);
    if (existing !== undefined) {
      violations.push(
        `questions "${existing}" and "${question.id}" share an identical prompt`
      );
    } else {
      seen.set(key, question.id);
    }
  }
  return violations;
}

// --- Redundancy (Mayer's principle) — mechanical pre-pass for the judge ---

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "with", "on",
  "at", "by", "is", "are", "was", "were", "be", "been", "it", "its",
  "this", "that", "these", "those", "as", "from", "not", "no", "but",
  "you", "your", "their", "they", "we", "our",
]);

function contentTokens(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Flattens every string prop value of a card into one text blob. */
export function cardText(props: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  walk(props);
  return parts.join(" ");
}

/**
 * Share of the card's content tokens that also appear in the narration
 * sentence it enters on. 1.0 = the card is a transcript of the narration.
 */
export function tokenOverlapRatio(card: string, narration: string): number {
  const cardTokens = contentTokens(card);
  if (cardTokens.length === 0) return 0;
  const narrationTokens = new Set(contentTokens(narration));
  const overlapping = cardTokens.filter((t) => narrationTokens.has(t)).length;
  return overlapping / cardTokens.length;
}

export interface RedundancyCandidate {
  unitId: string;
  cardIndex: number;
  template: string;
  overlap: number;
}

export const REDUNDANCY_THRESHOLD = 0.6;

/**
 * Mechanical redundancy pre-pass: cards whose text overlaps their narration
 * sentence by more than the threshold. The judge confirms intent.
 */
export function findRedundantCards(unit: {
  unitId: string;
  narration: Array<{ id: string; text: string }>;
  cards: Array<{
    template: string;
    props: Record<string, unknown>;
    enterAt: { narration: string };
  }>;
}): RedundancyCandidate[] {
  const narrationById = new Map(unit.narration.map((s) => [s.id, s.text]));
  const candidates: RedundancyCandidate[] = [];
  unit.cards.forEach((card, cardIndex) => {
    const sentence = narrationById.get(card.enterAt.narration);
    if (sentence === undefined) return;
    const overlap = tokenOverlapRatio(cardText(card.props), sentence);
    if (overlap > REDUNDANCY_THRESHOLD) {
      candidates.push({
        unitId: unit.unitId,
        cardIndex,
        template: card.template,
        overlap: Number(overlap.toFixed(3)),
      });
    }
  });
  return candidates;
}

// --- Excluded-fact leak (mechanical, pass/fail) ---

export interface ExcludedFactLeak {
  factStatement: string;
  /** The distinctive tokens of the fact found in the course text. */
  matchedTokens: string[];
}

/** Numeric tokens (incl. 70,000 / $82m / 42nd style) from a statement. */
function numericTokens(text: string): string[] {
  return (text.match(/\d[\d,.]*/g) ?? []).map((t) =>
    t.replace(/[,.]/g, "").replace(/^0+/, "")
  );
}

/**
 * Mechanical check that no excluded fact's content appears anywhere in the
 * course text. A fact leaks when the course contains one of its numeric
 * tokens together with at least 40% of its distinctive words, or (for
 * number-free facts) at least 70% of its distinctive words.
 */
export function findExcludedFactLeaks(
  courseText: string,
  excludedFacts: Array<{ statement: string }>
): ExcludedFactLeak[] {
  const courseTokens = new Set(contentTokens(courseText));
  const courseNumbers = new Set(numericTokens(courseText));

  const leaks: ExcludedFactLeak[] = [];
  for (const fact of excludedFacts) {
    const words = [...new Set(contentTokens(fact.statement))];
    const numbers = [...new Set(numericTokens(fact.statement))];
    const wordHits = words.filter((w) => courseTokens.has(w));
    const numberHits = numbers.filter((n) => courseNumbers.has(n));
    const wordShare = words.length === 0 ? 0 : wordHits.length / words.length;

    const leaked =
      numbers.length > 0
        ? numberHits.length > 0 && wordShare >= 0.4
        : wordShare >= 0.7;
    if (leaked) {
      leaks.push({
        factStatement: fact.statement,
        matchedTokens: [...numberHits, ...wordHits].slice(0, 12),
      });
    }
  }
  return leaks;
}
