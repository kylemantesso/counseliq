import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type SourceDocFactsCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export type StoredPageExtractionBody = {
  facts?: StoredExtractionFact[];
};

export type StoredExtractionFact = {
  statement: string;
  claimClass: string;
  conceptKey: string;
  provenance?: string[];
  sourceLabel?: string;
  year?: number;
  flagged?: boolean;
  excluded?: boolean;
  flagReason?: string;
};

export type SourceDocFactRow = {
  pageN: number;
  factIndex: number;
  statement: string;
  claimClass: string;
  conceptKey: string;
  provenance: string[];
  sourceLabel?: string;
  year?: number;
  flagged: boolean;
  excluded: boolean;
  thumbKey?: string;
};

export type SourceDocFactCounts = {
  total: number;
  approvedWithSource: number;
  institutionAsserted: number;
  excluded: number;
  extractedCandidates: number;
  pendingCandidates: number;
};

export type SourceDocFactReviewStatus =
  | "conversion_pending"
  | "extracting_facts"
  | "needs_review"
  | "approved";

export type SourceDocFactReview = {
  status: SourceDocFactReviewStatus;
  extractionComplete: boolean;
  extractedPages: number;
  expectedPages: number;
  facts: SourceDocFactCounts;
};

async function loadFactRowsAndPageCoverage(
  ctx: SourceDocFactsCtx,
  sourceDocId: Id<"sourceDocs">
): Promise<{
  rows: SourceDocFactRow[];
  extractedPages: number;
  expectedPages: number;
}> {
  const [slides, extractedRows] = await Promise.all([
    ctx.db
      .query("slides")
      .withIndex("by_source_doc_and_n", (q) => q.eq("sourceDocId", sourceDocId))
      .take(500),
    ctx.db
      .query("pageExtractions")
      .withIndex("by_source_doc_and_n", (q) => q.eq("sourceDocId", sourceDocId))
      .take(500),
  ]);

  const thumbByPage = new Map<number, string>();
  for (const slide of slides) {
    thumbByPage.set(slide.n, slide.thumbKey ?? slide.pngKey);
  }

  const rows: SourceDocFactRow[] = [];
  for (const extraction of extractedRows.sort((left, right) => left.n - right.n)) {
    const body = extraction.result as StoredPageExtractionBody;
    const facts = Array.isArray(body.facts) ? body.facts : [];
    for (const [factIndex, fact] of facts.entries()) {
      rows.push({
        pageN: extraction.n,
        factIndex,
        statement: fact.statement,
        claimClass: fact.claimClass,
        conceptKey: fact.conceptKey,
        provenance:
          Array.isArray(fact.provenance) && fact.provenance.length > 0
            ? fact.provenance
            : [`doc:${sourceDocId}:page:${extraction.n}`],
        ...(typeof fact.sourceLabel === "string" && fact.sourceLabel.trim().length > 0
          ? { sourceLabel: fact.sourceLabel.trim() }
          : {}),
        ...(typeof fact.year === "number" ? { year: fact.year } : {}),
        flagged: fact.flagged === true,
        excluded: fact.excluded === true,
        ...(thumbByPage.get(extraction.n)
          ? { thumbKey: thumbByPage.get(extraction.n) }
          : {}),
      });
    }
  }

  return {
    rows,
    extractedPages: extractedRows.length,
    expectedPages: slides.length,
  };
}

function summarizeFactRows(rows: SourceDocFactRow[]): SourceDocFactCounts {
  let approvedWithSource = 0;
  let institutionAsserted = 0;
  let excluded = 0;
  let pendingCandidates = 0;

  for (const row of rows) {
    if (row.excluded) {
      excluded += 1;
      continue;
    }
    if (row.flagged) {
      pendingCandidates += 1;
      continue;
    }
    if (row.sourceLabel && typeof row.year === "number") {
      approvedWithSource += 1;
      continue;
    }
    institutionAsserted += 1;
  }

  return {
    total: rows.length,
    approvedWithSource,
    institutionAsserted,
    excluded,
    extractedCandidates: rows.length,
    pendingCandidates,
  };
}

export async function listSourceDocFactRows(
  ctx: SourceDocFactsCtx,
  sourceDocId: Id<"sourceDocs">
): Promise<SourceDocFactRow[]> {
  const { rows } = await loadFactRowsAndPageCoverage(ctx, sourceDocId);
  return rows;
}

export async function getSourceDocFactReviewFromDoc(
  ctx: SourceDocFactsCtx,
  doc: Doc<"sourceDocs">
): Promise<SourceDocFactReview> {
  const { rows, extractedPages, expectedPages } =
    await loadFactRowsAndPageCoverage(ctx, doc._id);
  const extractionComplete = expectedPages === 0 || extractedPages >= expectedPages;
  const facts = summarizeFactRows(rows);

  const status: SourceDocFactReviewStatus =
    doc.status !== "converted"
      ? "conversion_pending"
      : !extractionComplete
        ? "extracting_facts"
        : facts.pendingCandidates > 0
          ? "needs_review"
          : "approved";

  return {
    status,
    extractionComplete,
    extractedPages,
    expectedPages,
    facts,
  };
}
