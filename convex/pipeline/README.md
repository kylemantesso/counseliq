# CounselIQ pipeline (Milestone 4 — course compiler + QA judge)

Durable state machine that walks a course-generation "run" from upload to
publication, pausing at three human review gates. As of M2, **ingestion is
real**: uploaded source documents (pptx/pdf) are converted by an external
converter service into per-page artifacts — rendered PNG, extracted text +
speaker notes, embedded images, candidate brand theme — content-addressed in
an S3-compatible object store, with every artifact carrying a provenance ID.
As of M3, **EXTRACTING is real**: a per-page multimodal LLM pass (via
OpenRouter) produces a structured knowledge inventory (concepts, facts with
claim classes, entities, quotes), unsourced statistics are flagged in code,
and the flagged facts become real gate-1 review items. As of M4,
**COMPILING and QA are real**: a two-pass compiler turns the reviewed
inventory into a schema-valid Course Definition, an adversarial QA judge on
a different model family traces every narration sentence back to provenance,
and gate 2 reviews the compiled course (judge flags attached) in a dedicated
course viewer with send-back-for-re-authoring. Script/asset generation
remains stubbed for M5.

## State diagram

```
UPLOADED → CONVERTING → CONVERTED
  → EXTRACTING → EXTRACTED
  → GATE_1_KNOWLEDGE_REVIEW   (waits for decideGate(1))
  → COMPILING → COMPILED
  → QA_RUNNING → QA_PASSED | QA_FLAGGED
  → GATE_2_COURSE_REVIEW      (waits for decideGate(2);
                               may send back to COMPILING for re-authoring)
  → GENERATING_SCRIPT → GENERATING_ASSETS   (stubs until M5)
  → GATE_3_PREVIEW            (waits for decideGate(3))
  → PUBLISHED

(any state) → FAILED with { retryable, cause }   FAILED is terminal.
```

The full map lives in [`states.ts`](./states.ts) (`ALLOWED_TRANSITIONS`).

**M4 resequencing rationale** (one-time sanctioned contract change): the old
order compiled before knowledge review, which meant the compiler consumed
unreviewed facts. Now gate 1 feeds the compiler — the compiler only ever
sees the reviewed inventory (approved facts with confirmed sources; excluded
facts filtered out in code). The QA judge runs on the compiled course
*before* any money is spent on TTS/assets, and `QA_FLAGGED` routes to gate 2
with the flags attached so a human decides: send flagged units back to
COMPILING for re-authoring, or approve. Gate 2 (renamed from
`GATE_2_QUIZ_REVIEW`) reviews the compiled course as a whole — narration
provenance, cards, questions, and judge flags — in the course viewer.

## Converter architecture

```
walkthrough / upload client
    │ 1. presignPut (objectStore.ts) → PUT source doc to object store
    │ 2. registerSourceDoc × N, startRun (docs linked to run)
    ▼
Convex: ingestAndExtract workflow
    │ 3. transition CONVERTING; dispatchAndAwaitConversions dispatches
    │    POST /convert { jobId, sourceKey, kind, callbackUrl } per doc
    │    (HMAC-signed with CONVERTER_CALLBACK_SECRET)
    ▼
services/converter (Node/TS, Fly.io or Docker)
    │ 4. download source → pptx: LibreOffice → pdf; OOXML text/notes/theme
    │    → pdftoppm renders per-page PNG + thumbnail → pdf-native text via
    │    unpdf → upload every artifact content-addressed (sha256/<hash>.<ext>,
    │    skip if key exists)
    │ 5. POST /converter/callback { jobId, manifest } (HMAC-signed)
    ▼
Convex http action /converter/callback (http.ts)
    │ 6. verify HMAC → validate manifest with the SHARED Zod contract
    │    (@counseliq/course-schema `conversionCallbackSchema`) → idempotently
    │    upsert slides (provenance doc:{sourceDocId}:page:{n}) + assets →
    │    when all docs converted: transition CONVERTED
    ▼
workflow continues: EXTRACTING → EXTRACTED → GATE_1_KNOWLEDGE_REVIEW
(gate-1 approval starts the compileAndJudge workflow)
```

- **The manifest contract lives in one place** —
  `packages/course-schema/src/ingestion.ts` — imported by both the converter
  (output validation) and the callback (input validation). Neither side may
  drift.
- **Timeout/failure:** if no callback lands within `CONVERTER_TIMEOUT_MS`
  (default 5 min), the dispatch is retried once (bounded), then the run
  transitions `FAILED { retryable: true, cause }`.
- **Idempotency:** artifacts are content-addressed (re-uploads skipped);
  slides are upserted by `(sourceDocId, n)`; assets by `objectKey`;
  re-delivered callbacks change nothing.

## Extraction architecture (M3)

```
CONVERTED → EXTRACTING (workflows.ts → extract.runExtraction, "use node")
    │ 1. record runs.promptVersions (exact prompt versions + routed models)
    │ 2. fan out extractPage per page via the extractionPool workpool
    │    (EXTRACTION_PARALLELISM, default 2; EXTRACTION_MODE=sequential
    │    falls back to in-order calls; EXTRACTION_TIMEOUT_MS default 8 min)
    ▼
extractPage (per page, retried by the workpool)
    │ 3. cache check: pageExtractions keyed by
    │    {pageHash}:{promptVersionTag}:{model} — cached pages skip the LLM
    │ 4. presign GET → fetch page PNG → base64
    │ 5. LLM call (extract-page prompt): image + text layer + speaker notes
    │    → structured LlmPageExtraction (Zod-validated; one retry with
    │    validator errors appended)
    │ 6. code flag floor (applyFlagFloor): statistic missing sourceLabel or
    │    year ⇒ flagged, reason missing-source-or-year — never unflags an
    │    LLM-flagged fact
    │ 7. provenance stamped: doc:{sourceDocId}:page:{n}
    ▼
runExtraction (merge + write)
    │ 8. deterministic pre-group of concepts by normalized title, then ONE
    │    merge-inventory LLM call consolidating concepts across all docs
    │ 9. assembleInventory: remap fact conceptKeys, dedupe entities/quotes,
    │    preserve multi-doc provenance
    │ 10. replaceInventory: atomic, idempotent inventoryItems write
    │ 11. infer-theme for docs with no OOXML theme (2-3 page renders →
    │     CandidateTheme{method:"llm-inferred"}; non-fatal on failure)
    ▼
EXTRACTED → GATE_1_KNOWLEDGE_REVIEW
    │ 12. one reviewItem per flagged fact (payload: fact + provenance +
    │     page thumb key), replacing gate-1 placeholders
    │ 13. adminResolveReviewItem per item: approve-with-source (operator
    │     supplies sourceLabel/year → fact unflagged) or exclude (fact
    │     marked excluded — invisible to the compiler)
    │ 14. decideGate(1) approval requires every item resolved
    │     (GATE_ITEMS_UNRESOLVED otherwise); approval starts compileAndJudge
    ▼
COMPILING → COMPILED → QA_RUNNING → … (see "Compiler architecture" below)
```

## Compiler architecture (M4)

```
GATE_1_KNOWLEDGE_REVIEW approved → compileAndJudge workflow
    │ 1. COMPILING; record runs.promptVersions (compile-structure@1,
    │    author-unit@1, judge-course@1 + routed models)
    ▼
runCompilation (compiler/compile.ts, "use node")
    │ 2. STRUCTURE PASS — one LLM call (compile-structure@1):
    │    reviewed inventory (excluded facts filtered IN CODE before the
    │    prompt is built) + course params + pacing rules → module/unit
    │    skeleton with per-unit concept + assigned fact keys (Zod-gated)
    │ 3. AUTHORING PASS — fan-out per unit via the compilePool workpool
    │    (COMPILE_PARALLELISM, default 2): unit concept + assigned facts
    │    w/ provenance + card-template manifest (CARD_TEMPLATES) +
    │    narration rules → full micro-unit: narration, cards, hook +
    │    retrieve questions, single-sentence anchor. Zod cross-reference
    │    refinements (card enterAt words exist in narration, question refs
    │    resolve). Failed parse → one retry with validator errors appended
    │    → still failing marks the unit failed for re-authoring.
    │    Unit results are cached (unitAuthoring) keyed by
    │    {factsHash}:{promptVersion}:{model} so re-runs skip clean units.
    │ 4. CODE-ENFORCED RULES (compiler/rules.ts, pure):
    │    - generic-card cap: ≤1 in 3, never consecutive
    │    - every card's provenance references inventory keys or
    │      "compiler:derived"
    │    - banned-claims lexicon (unattributed superlatives, guarantees,
    │      migration-outcome promises)
    │    - statistic cards must carry sourceLabel
    │    - question conceptTag matches the unit; no duplicate prompts
    │ 5. assemble + validate against courseDefinitionSchema
    │    (compiler/assemble.ts, pure) → saveCompiledCourse writes
    │    courses / microUnits / questions, links runs.courseId. Partial
    │    re-authoring (reAuthorUnitIds + judge-flag feedback in the unit
    │    prompt) preserves untouched units.
    ▼
COMPILED → QA_RUNNING → runQaJudge (see below) → QA_PASSED | QA_FLAGGED
    ▼
GATE_2_COURSE_REVIEW (course viewer; approve → GENERATING_SCRIPT,
                      send-back(unitIds) → COMPILING re-authoring loop)
```

## QA judge rubric (M4)

`compiler/judge.ts` (orchestration) + `compiler/judgeCore.ts` (pure logic),
runs at `QA_RUNNING` on a **different model family** than the compiler
(`judge-course` → `anthropic/claude-sonnet-4.5` by default) so the judge
doesn't share the author's blind spots. The judge only flags — it never
edits the course.

1. **Mechanical pre-pass (code, not LLM):**
   - excluded-fact text leak — any excluded inventory fact's text appearing
     in narration/cards is a **hard fail** (course cannot pass QA);
   - >60% token-overlap between cards → redundancy candidates handed to the
     LLM for confirmation.
2. **LLM pass (judge-course@1):** per-sentence narration classification —
   `traced` (maps to an approved fact), `derived` (legitimate synthesis),
   `unsupported` (factual claim with no basis — error); redundancy
   confirmation; pedagogy lint (one concept per unit, hook poses a
   commitment question, single-sentence anchor, retrieve questions test the
   unit's concept — warnings).
3. **Verdict:** any unsupported factual claim or hard fail → `QA_FLAGGED`,
   else `QA_PASSED`. Both proceed to gate 2; structured flags persist to
   `microUnits.qa` (per-sentence classifications, unit flags) and
   `courses.qa` (verdict, course-level flags) so the viewer can render
   markers inline.

### Gate-2 course viewer

`/admin/runs/[id]/gate-2` — left rail: module → unit tree with QA status
chips and send-back checkboxes; main pane: narration with judge
classification markers, cards as structured-props views (template name +
labelled props; tracked TODO to swap for `@counseliq/cards` renderers),
hook/retrieve questions with answers + explanations (inline edit +
single-question regenerate), anchor. Actions: `adminDecideGate(2, approve)`
→ GENERATING_SCRIPT; `adminSendBackForReauthoring(runId, unitIds)` →
COMPILING (re-runs compileAndJudge for just those units, feeding judge
flags back into the authoring prompt).

### Model routing + swap procedure

Task → model routing lives in [`llm/models.ts`](./llm/models.ts). The
extraction tasks (`extract-page`, `merge-inventory`, `infer-theme`) and the
compiler tasks (`compile-structure`, `author-unit`) default to
`google/gemini-2.5-flash`; `judge-course` defaults to
`anthropic/claude-sonnet-4.5` (deliberately a different family from the
compiler). To swap a model:

1. Preferred: set the env override on the deployment —
   `MODEL_EXTRACT_PAGE`, `MODEL_MERGE_INVENTORY`, `MODEL_INFER_THEME`,
   `MODEL_COMPILE_STRUCTURE`, `MODEL_AUTHOR_UNIT`, or `MODEL_JUDGE_COURSE`
   (`npx convex env set MODEL_JUDGE_COURSE=openai/gpt-5.5`).
   Env always wins over the code default.
2. Permanent: change `DEFAULT_MODELS` in `llm/models.ts` and add the model's
   prices to [`llm/pricing.ts`](./llm/pricing.ts) (set `verifiedAt`).
3. Run `npm run eval` — runs record prompt versions + models together, so
   the swap is measurable against `eval-history.jsonl`.

Per-task requirements: `extract-page` and `infer-theme` need vision +
structured output; `merge-inventory` needs long context. `max_tokens` caps
per task live in `models.ts`; requests use `temperature: 0` so eval runs
are comparable.

### Prompt versioning

Prompts are versioned markdown files in [`prompts/`](./prompts/) named
`{id}@{version}.md` with YAML frontmatter (id, version, requirements,
output schema ref). Convex's bundler can't import `.md`, so
`npm run prompts:build` (scripts/build-prompts.mjs) generates the checked-in
[`prompts/index.ts`](./prompts/index.ts); a drift test
([`prompts/prompts.test.ts`](./prompts/prompts.test.ts)) fails CI when the
generated file is stale. To revise a prompt, **copy to a new version**
(`extract-page@3.md`), edit, rebuild — the highest version wins and old
versions stay for history. `runs.promptVersions` records exactly which
versions + models a run used; the page cache key includes the version tag,
so bumping a prompt invalidates cached page extractions.

### Cost + observability

Every LLM call writes an `llmCalls` row (runId, stage, promptVersion, model,
tokensIn/Out, provider-reported costUsd, latencyMs). `getRunCost(runId)`
(admin) / `getRunCostInternal` return totals itemized by stage and model.
[`llm/pricing.ts`](./llm/pricing.ts) is an operator-verified price sheet used
only for pre-run estimates in `npm run eval` / `npm run eval:compile`;
actual cost always comes from OpenRouter usage accounting.

### Eval workflow (on-demand, costs real money)

Golden labels live in `packages/course-schema/fixtures/labels/*.labels.json`
(expected concepts with aliases + pages, known-dirty statistics, must-extract
entities). CI runs unit/schema tests only; the eval is on-demand:

```bash
npm run dev:stack               # local stack with OPENROUTER_API_KEY set
npm run eval -- --yes           # requires confirmed labels
npm run eval -- --yes --allow-unconfirmed-labels   # while iterating
```

The harness prints an estimated cost, runs REAL extraction over both fixture
docs, scores concept recall (lenient title/alias match, threshold per
fixture in `eval.config.json`), flag completeness (100% of known-dirty stats
must be flagged — any miss fails), a precision guard (warn only), and
must-extract entities (warn only), then appends one JSON line to
`eval-history.jsonl` with prompt versions, models, and actual vs estimated
cost. Operators sign off labels by setting `"confirmed": true`.

### Compiler eval (`npm run eval:compile`) — the M4 exit test

```bash
npm run dev:stack                        # local stack with OPENROUTER_API_KEY
npm run eval:compile -- --yes            # full live run (costs real money)
npm run eval:compile -- --yes --reuse    # rescore an existing GATE_2 run
npm run eval:compile -- --yes --judge-only   # judge eval on seeded bad courses
```

The script prints a cost estimate (from `estimateCompileCost` +
`llm/pricing.ts`) and requires `--yes`. A full run drives the REAL pipeline
over golden fixture #1's source docs (`fixtures/ingestion/doc-a`/`doc-b`),
auto-resolves gate 1 the same way `walkthrough.mjs` does, waits for
`GATE_2_COURSE_REVIEW`, then scores the compiled course.
[`golden-fixture-1.json`](../../packages/course-schema/fixtures/golden-fixture-1.json)
was authored from different source material (a specific requested course),
so it serves as a **format reference only** — no content/concept comparison
is scored against it:

- **Structural sanity** — module count within ±1 of the fixture, every unit
  schema-valid with hook + retrieve + anchor, generic-card ratio within cap.
  Compiled unit concepts are printed for information.
- **Compliance invariants (pass/fail)** — no `unsupported-claim` or
  `banned-claim` judge flags, every unit judged, statistic cards sourced,
  and a mechanical excluded-fact text check re-run by the script itself.
  Other judge flags (redundant-card, pedagogy lint) are printed as gate-2
  review material but do not fail the eval — reviewing them is what gate 2
  is for.

It prints per-metric scores, prompt + model versions, and $/course, then
appends a `kind:"compile"` row to `eval-history.jsonl`. `--judge-only` seeds
three known-bad courses (hallucinated fact, provenance-stripped card,
redundant card) via `compiler/judgeEval.ts`, runs `runQaJudge` on each, and
asserts every defect is caught.

## Invariants

- **All `runs.state` writes go through `transitionRun`** (well,
  `applyRunTransition` in [`transitions.ts`](./transitions.ts), which the
  mutation wraps). It validates against the transition map, patches the run,
  and journals a `runEvents` row. The one exception is run *creation*:
  `startRun` inserts the run already in `UPLOADED`.
- Gates only advance via `decideGate` (human/admin action) — workflows park
  runs at gate states and stop.
- Rejecting a gate transitions the run to `FAILED { retryable: true }`.
- Multiple sourceDocs per run are legal — never assume one-doc-one-course.

## Files

| File | Purpose |
|------|---------|
| `states.ts` | State + gate types, `ALLOWED_TRANSITIONS`, `GATE_STATES` |
| `transitions.ts` | `transitionRun` — the single writer of `runs.state` |
| `ingestion.ts` | `registerSourceDoc`, `applyConversionManifest`, `dispatchAndAwaitConversions` |
| `objectStore.ts` | Presigned PUT/GET URLs (`@aws-sdk/client-s3`, `"use node"`) |
| `hmac.ts` | HMAC-SHA256 sign/verify (Web Crypto; mirrors the converter's) |
| `steps.ts` | `runNoopStage` — stand-in for still-stubbed pipeline work |
| `workflows.ts` | `ingestAndExtract`, `compileAndJudge`, `generateAssets`, `publishPhase` (durable, via `@convex-dev/workflow`) |
| `runs.ts` | `startRun`, `decideGate` (internal) + `adminStartRun`, `adminDecideGate`, `adminSendBackForReauthoring` (public, admin-gated) |
| `reviewItems.ts` | Gate-1 flagged-fact items + `adminResolveReviewItem`; placeholders for gate 3 |
| `courses.ts` | Course persistence: `saveCompiledCourse`, reviewed-inventory query, unit-authoring cache, QA writes, question edit/regenerate |
| `compiler/compile.ts` | `runCompilation` — structure pass + authoring fan-out via `compilePool` + `regenerateQuestion` (`"use node"`) |
| `compiler/assemble.ts` | Pure assembly: prompt builders, unit compliance, `assembleCourseDefinition`, `tryAssemble` |
| `compiler/rules.ts` | Pure code-enforced rules: banned claims, generic-card cap, provenance, stat sources, question checks, overlap, excluded-leak |
| `compiler/schemas.ts` | Zod wire contracts for structure/authoring/judge LLM outputs |
| `compiler/judge.ts` | `runQaJudge` action — orchestrates the judge, persists `microUnits.qa` / `courses.qa` |
| `compiler/judgeCore.ts` | Pure judge logic: mechanical pre-pass, prompt build, verdict derivation |
| `compiler/judgeEval.ts` | `seedBadCourse` — known-bad fixture courses for the judge eval |
| `extract.ts` | `runExtraction` orchestrator + `extractPage` per-page action + `extractionPool` workpool (`"use node"`) |
| `extraction/assemble.ts` | Pure assembly: flag floor + provenance stamping, concept pre-grouping, inventory merge |
| `inventory.ts` | Extraction data layer: plan/page queries, page-extraction cache, `replaceInventory`, inventory queries |
| `llm/client.ts` | `LlmClient` interface + OpenRouter implementation + `completeStructured` (Zod enforcement) |
| `llm/models.ts` | Task → model routing, env overrides, per-task `max_tokens` |
| `llm/pricing.ts` | Operator-verified price sheet for pre-run estimates |
| `llm/schemas.ts` | JSON schemas (from Zod) for structured outputs |
| `llmCalls.ts` | `recordLlmCall`, `getRunCost`, `estimateExtractionCost` |
| `prompts/` | Versioned prompt `.md` files + generated `index.ts` |
| `queries.ts` | `getRun`, `listRunsByState`, `gateQueue`, `listSourceDocs`, `getSourceDoc` (admin) + internals |
| `seed.ts` | Seeds "Example University" for the walkthrough |
| `../http.ts` | `POST /converter/callback` http action |

Tests: [`../pipeline.test.ts`](../pipeline.test.ts) (transitions/gates,
resequenced map), [`../ingestion.test.ts`](../ingestion.test.ts) (callback
HMAC/validation/idempotency),
[`../extraction.test.ts`](../extraction.test.ts) (inventory idempotency,
gate-1 item generation and resolution rules, page cache),
[`../courses.test.ts`](../courses.test.ts) (course persistence, reviewed
inventory filtering, definition round-trip, authoring cache),
[`../compiler.test.ts`](../compiler.test.ts) (send-back mutation),
[`llm/client.test.ts`](./llm/client.test.ts) (routing, retries, structured
output — mocked fetch),
[`extraction/assemble.test.ts`](./extraction/assemble.test.ts) (flag floor,
merge provenance), [`compiler/rules.test.ts`](./compiler/rules.test.ts)
(every code-enforced rule),
[`compiler/assemble.test.ts`](./compiler/assemble.test.ts) (assembly +
compliance), and [`compiler/judge.test.ts`](./compiler/judge.test.ts)
(mechanical pre-pass, verdict derivation — mocked LLM).

Admin UI: `/admin/source-docs` (list → per-doc page grid with PNG, text,
notes, provenance ID, theme candidates), `/admin/runs/[id]` (state, events,
itemized LLM cost, inventory browser with claim-class chips and flagged
filter), `/admin/runs/[id]/gate-1` (flagged-fact review queue with
approve-with-source / exclude; the gate decision unlocks once every item is
resolved), and `/admin/runs/[id]/gate-2` (course viewer — see "Gate-2
course viewer" above).

## Operator setup

1. **Object store** — any S3-compatible bucket (Tigris via Fly, AWS S3, or
   local MinIO from `services/converter/docker-compose.yml`).
2. **Converter** — deploy `services/converter` to Fly.io from the repo root:

   ```bash
   fly launch --config services/converter/fly.toml --no-deploy   # first time
   fly secrets set -c services/converter/fly.toml \
     OBJECT_STORE_ENDPOINT=… OBJECT_STORE_REGION=… OBJECT_STORE_BUCKET=… \
     OBJECT_STORE_ACCESS_KEY_ID=… OBJECT_STORE_SECRET_ACCESS_KEY=… \
     CONVERTER_CALLBACK_SECRET=… CONVEX_CALLBACK_URL=https://<deployment>.convex.site/converter/callback
   fly deploy --config services/converter/fly.toml --dockerfile services/converter/Dockerfile .
   ```

   Or locally: `docker compose -f services/converter/docker-compose.yml up --build`
   (includes MinIO; converter on :8080, MinIO on :9000).
3. **Convex deployment env** (`npx convex env set …`):
   `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_REGION`, `OBJECT_STORE_BUCKET`,
   `OBJECT_STORE_ACCESS_KEY_ID`, `OBJECT_STORE_SECRET_ACCESS_KEY`,
   `CONVERTER_URL`, `CONVERTER_CALLBACK_SECRET`, and optionally
   `CONVERTER_TIMEOUT_MS` / `CONVERTER_CALLBACK_URL` (defaults to
   `$CONVEX_SITE_URL/converter/callback`).
4. **LLM extraction env**: `OPENROUTER_API_KEY` (required), and optionally
   `MODEL_EXTRACT_PAGE` / `MODEL_MERGE_INVENTORY` / `MODEL_INFER_THEME`
   (model overrides), `EXTRACTION_PARALLELISM` (default 2),
   `EXTRACTION_MODE=sequential`, `EXTRACTION_TIMEOUT_MS` (default 8 min).
   `dev:stack` forwards these to the local deployment automatically from the
   shell env or the repo-root `.env.local`.
5. **Fixture docs** — place two real source documents at
   `packages/course-schema/fixtures/ingestion/doc-a.(pptx|pdf)` and
   `doc-b.(pptx|pdf)`.

## Driving it

### One-command local stack

```bash
npm run dev:stack          # MinIO + converter (Docker) + local Convex + web app
npm run walkthrough:local  # in another terminal: e2e run against that stack
```

`dev:stack` starts docker compose, configures a **local anonymous Convex
deployment** (cloud dev can't reach localhost) with all ingestion env vars —
including `CLERK_JWT_ISSUER_DOMAIN` derived from the web app's Clerk
publishable key — then runs `convex dev` and the Next.js dev server together.
Ctrl-C stops everything and restores `.env.local` to the cloud dev deployment.

Options: `WEB_PORT=3001` (web port, default 3005), `CONVERTER_PORT=8090`
(converter host port), `ADMIN_EMAILS=you@example.com` (grant your login admin
on the local deployment so `/admin/source-docs` works).

### Against your cloud dev deployment

```bash
npm run walkthrough                # upload fixtures → real conversion → gates → PUBLISHED
npm run walkthrough -- --skip-docs # M1-style run, conversion phase no-ops through
npm test                           # course-schema + converter + convex-test suites
```

Requires a converter the cloud deployment can reach (e.g. Fly.io) and the env
vars from "Operator setup" set on that deployment.

## What is stubbed, and which milestone makes it real

| Stub | Today (M4) | Becomes real in |
|------|------------|-----------------|
| `convert` stage | **real** (services/converter) | — |
| `extract` stage | **real** (per-page LLM extraction → knowledge inventory) | — |
| `compile` stage | **real** (two-pass compiler → Course Definition, code-enforced rules) | — |
| `qa` stage | **real** (adversarial judge, provenance tracing, `QA_FLAGGED` routing) | — |
| `generate-script` / `generate-assets` stages | sleep 1s | M5 — script generation, TTS, asset rendering |
| Gate-1 review items | **real** (one per flagged fact, per-item resolution) | — |
| Gate-2 review | **real** (course viewer + send-back re-authoring) | — |
| Gate-3 review items | hard-coded placeholders | M5 — course preview |
| Card rendering in gate-2 | structured-props view | when `@counseliq/cards` exists (tracked TODO) |
| `llmCalls` table | **real** (every call recorded; `getRunCost` itemized) | — |
