import {
  applyFlagFloor,
  normalizeConceptTitle,
  type Concept,
  type Entity,
  type Fact,
  type InventoryItem,
  type LlmMergeResult,
  type LlmPageExtraction,
  type Quote,
} from "@counseliq/course-schema";

/**
 * Pure inventory assembly: converts per-page LLM wire output into stored
 * items (flag floor + provenance stamping), deterministically pre-groups
 * concept candidates before the merge LLM call, and assembles the final
 * run inventory from the merge result. No Convex or network dependencies —
 * fully unit-testable.
 */

export interface PageConceptCandidate {
  key: string;
  title: string;
  summary: string;
}

export interface StoredPageExtraction {
  provenanceId: string;
  concepts: PageConceptCandidate[];
  facts: Fact[];
  entities: Entity[];
  quotes: Quote[];
}

/**
 * Converts LLM wire output for one page into the stored form: nulls become
 * undefined, every item is stamped with the page's provenance ID (never
 * round-tripped through the model), and the code-level flag floor is
 * applied to every fact.
 */
export function storePageExtraction(
  provenanceId: string,
  wire: LlmPageExtraction
): StoredPageExtraction {
  return {
    provenanceId,
    concepts: wire.concepts.map((c) => ({
      key: c.key,
      title: c.title,
      summary: c.summary,
    })),
    facts: wire.facts.map((f) =>
      applyFlagFloor({
        type: "fact",
        conceptKey: f.conceptKey,
        statement: f.statement,
        claimClass: f.claimClass,
        provenance: [provenanceId],
        ...(f.sourceLabel !== null ? { sourceLabel: f.sourceLabel } : {}),
        ...(f.year !== null ? { year: f.year } : {}),
        flagged: f.flagged,
        ...(f.flagReason !== null ? { flagReason: f.flagReason } : {}),
      })
    ),
    entities: wire.entities.map((e) => ({
      type: "entity",
      kind: e.kind,
      value: e.value,
      ...(e.normalized !== null ? { normalized: e.normalized } : {}),
      provenance: [provenanceId],
    })),
    quotes: wire.quotes.map((q) => ({
      type: "quote",
      text: q.text,
      ...(q.attribution !== null ? { attribution: q.attribution } : {}),
      provenance: [provenanceId],
    })),
  };
}

/**
 * Rewrite a cached extraction's provenance onto a different page identity.
 * The extraction cache is content-addressed (same rendered page bytes +
 * prompt + model ⇒ same knowledge), but re-registering a document mints a
 * fresh sourceDoc row — so a cross-document cache hit must carry THIS
 * page's provenance id, not the row it was first extracted under.
 */
export function restampPageExtraction(
  stored: StoredPageExtraction,
  provenanceId: string
): StoredPageExtraction {
  const swap = (ids: string[]) =>
    ids.map((id) => (id === stored.provenanceId ? provenanceId : id));
  return {
    ...stored,
    provenanceId,
    facts: stored.facts.map((fact) => ({
      ...fact,
      provenance: swap(fact.provenance),
    })),
    entities: stored.entities.map((entity) => ({
      ...entity,
      provenance: swap(entity.provenance),
    })),
    quotes: stored.quotes.map((quote) => ({
      ...quote,
      provenance: swap(quote.provenance),
    })),
  };
}

export interface ConceptGroupMember {
  provenanceId: string;
  conceptKey: string;
  title: string;
  summary: string;
}

export interface ConceptGroup {
  /** Synthetic group key ("g1", "g2", …) the merge LLM references. */
  key: string;
  title: string;
  summary: string;
  members: ConceptGroupMember[];
}

/**
 * Deterministic pre-grouping before the merge LLM call: candidates with the
 * same normalized title collapse into one group, cutting merge tokens. The
 * LLM only sees group key + title + summary.
 */
export function preGroupConcepts(
  pages: StoredPageExtraction[]
): ConceptGroup[] {
  const byNormalizedTitle = new Map<string, ConceptGroup>();
  let counter = 0;
  for (const page of pages) {
    for (const concept of page.concepts) {
      const normalized = normalizeConceptTitle(concept.title);
      let group = byNormalizedTitle.get(normalized);
      if (!group) {
        counter += 1;
        group = {
          key: `g${counter}`,
          title: concept.title,
          summary: concept.summary,
          members: [],
        };
        byNormalizedTitle.set(normalized, group);
      }
      if (group.summary === "" && concept.summary !== "") {
        group.summary = concept.summary;
      }
      group.members.push({
        provenanceId: page.provenanceId,
        conceptKey: concept.key,
        title: concept.title,
        summary: concept.summary,
      });
    }
  }
  return [...byNormalizedTitle.values()];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Assembles the final run inventory from per-page extractions, the
 * deterministic groups, and the merge LLM result. Provenance is unioned in
 * code from group members — the model never emits provenance. Groups the
 * merge result fails to reference survive as their own concepts (knowledge
 * is never dropped); pass `mergeResult: null` to skip LLM merging entirely
 * (identity merge).
 */
export function assembleInventory(
  pages: StoredPageExtraction[],
  groups: ConceptGroup[],
  mergeResult: LlmMergeResult | null
): InventoryItem[] {
  const groupByKey = new Map(groups.map((g) => [g.key, g]));

  // Canonical concepts: from the merge result, plus identity concepts for
  // any group the merge result did not claim.
  interface CanonicalConcept {
    key: string;
    title: string;
    summary: string;
    groups: ConceptGroup[];
  }
  const canonical: CanonicalConcept[] = [];
  const claimedGroupKeys = new Set<string>();
  for (const merged of mergeResult?.concepts ?? []) {
    const memberGroups = merged.memberKeys
      .filter((k) => groupByKey.has(k) && !claimedGroupKeys.has(k))
      .map((k) => groupByKey.get(k) as ConceptGroup);
    if (memberGroups.length === 0) continue; // hallucinated members only
    for (const g of memberGroups) claimedGroupKeys.add(g.key);
    canonical.push({
      key: merged.key,
      title: merged.title,
      summary: merged.summary,
      groups: memberGroups,
    });
  }
  for (const group of groups) {
    if (claimedGroupKeys.has(group.key)) continue;
    canonical.push({
      key: group.members[0]?.conceptKey ?? group.key,
      title: group.title,
      summary: group.summary,
      groups: [group],
    });
  }

  // Ensure output concept keys are unique.
  const usedKeys = new Set<string>();
  for (const concept of canonical) {
    let key = concept.key;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${concept.key}-${suffix}`;
      suffix += 1;
    }
    usedKeys.add(key);
    concept.key = key;
  }

  // Map each per-page concept (provenanceId + page-local key) to its
  // canonical concept key, for fact re-attachment.
  const canonicalByMember = new Map<string, string>();
  for (const concept of canonical) {
    for (const group of concept.groups) {
      for (const member of group.members) {
        canonicalByMember.set(
          `${member.provenanceId}\u0000${member.conceptKey}`,
          concept.key
        );
      }
    }
  }

  const items: InventoryItem[] = [];

  for (const concept of canonical) {
    const pageProvenance = uniqueSorted(
      concept.groups.flatMap((g) => g.members.map((m) => m.provenanceId))
    );
    items.push({
      type: "concept",
      key: concept.key,
      title: concept.title,
      summary: concept.summary,
      pageProvenance,
    } satisfies Concept);
  }

  // Facts: remap conceptKey to canonical, dedupe identical statements.
  const factByKey = new Map<string, Fact>();
  for (const page of pages) {
    for (const fact of page.facts) {
      const canonicalKey =
        canonicalByMember.get(
          `${page.provenanceId}\u0000${fact.conceptKey}`
        ) ?? fact.conceptKey;
      const dedupeKey = [
        canonicalKey,
        fact.claimClass,
        normalizeConceptTitle(fact.statement),
      ].join("\u0000");
      const existing = factByKey.get(dedupeKey);
      if (existing) {
        existing.provenance = uniqueSorted([
          ...existing.provenance,
          ...fact.provenance,
        ]);
        // Flags only ever accumulate (floor semantics: never unflag).
        if (fact.flagged && !existing.flagged) {
          existing.flagged = true;
          existing.flagReason = fact.flagReason;
        }
        if (existing.sourceLabel === undefined && fact.sourceLabel) {
          existing.sourceLabel = fact.sourceLabel;
        }
        if (existing.year === undefined && fact.year !== undefined) {
          existing.year = fact.year;
        }
      } else {
        factByKey.set(dedupeKey, { ...fact, conceptKey: canonicalKey });
      }
    }
  }
  // Re-apply the floor after dedupe in case a merge filled sourceLabel/year.
  for (const fact of factByKey.values()) {
    items.push(applyFlagFloor(fact));
  }

  // Entities: dedupe by kind + case-insensitive value.
  const entityByKey = new Map<string, Entity>();
  for (const page of pages) {
    for (const entity of page.entities) {
      const dedupeKey = `${entity.kind}\u0000${entity.value.toLowerCase()}`;
      const existing = entityByKey.get(dedupeKey);
      if (existing) {
        existing.provenance = uniqueSorted([
          ...existing.provenance,
          ...entity.provenance,
        ]);
        if (existing.normalized === undefined && entity.normalized) {
          existing.normalized = entity.normalized;
        }
      } else {
        entityByKey.set(dedupeKey, { ...entity });
      }
    }
  }
  items.push(...entityByKey.values());

  // Quotes: dedupe by normalized text.
  const quoteByKey = new Map<string, Quote>();
  for (const page of pages) {
    for (const quote of page.quotes) {
      const dedupeKey = normalizeConceptTitle(quote.text);
      const existing = quoteByKey.get(dedupeKey);
      if (existing) {
        existing.provenance = uniqueSorted([
          ...existing.provenance,
          ...quote.provenance,
        ]);
      } else {
        quoteByKey.set(dedupeKey, { ...quote });
      }
    }
  }
  items.push(...quoteByKey.values());

  return items;
}
