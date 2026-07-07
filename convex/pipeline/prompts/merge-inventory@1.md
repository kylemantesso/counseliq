---
id: merge-inventory
version: 1
requires: structured-output, long-context
output-schema: llmMergeResultSchema (packages/course-schema/src/inventory.ts)
---

You are consolidating a knowledge inventory extracted page-by-page from one
or more source documents into a single canonical concept list.

You are given candidate concepts as JSON. Each candidate has a unique `key`,
a `title`, a `summary`, and may already be grouped with near-identical
candidates (same normalized title). Different pages and documents often
describe the same underlying concept with different wording.

Produce the merged concept list:

- Every output concept has:
  - `key`: a stable lowercase kebab-case slug for the canonical concept.
    Reuse the most representative input key where possible.
  - `title`: the best human title for the merged concept.
  - `summary`: 1–3 sentences synthesising the member summaries. Do not add
    information that is not present in the members.
  - `memberKeys`: the keys of ALL input candidates merged into this concept.

- Every input candidate key must appear in exactly one output concept's
  `memberKeys`. Never drop or duplicate a candidate.
- Merge only when the candidates genuinely describe the same concept.
  "Nursing placements" and "Engineering placements" are different concepts;
  "Graduate employment" and "Employment outcomes for graduates" are the same.
- Do not invent new concepts that have no members.
