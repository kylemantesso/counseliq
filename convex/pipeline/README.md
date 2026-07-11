# CounselIQ pipeline (Milestone 6 — media enrichment)

Durable state machine that walks a course-generation "run" from upload to
publication, pausing at two run-level human review gates (plus source-doc fact
review before a run starts). As of M2, **ingestion is
real**: uploaded source documents (pptx/pdf) are converted by an external
converter service into per-page artifacts — rendered PNG, extracted text +
speaker notes, embedded images, candidate brand theme — content-addressed in
an S3-compatible object store, with every artifact carrying a provenance ID.
As of M3, **EXTRACTING is real**: a per-page multimodal LLM pass (via
OpenRouter) produces a structured knowledge inventory (concepts, facts with
claim classes, entities, quotes), unsourced statistics are flagged in code.
As of M4,
**COMPILING and QA are real**: a two-pass compiler turns the reviewed
inventory into a schema-valid Course Definition, an adversarial QA judge on
a different model family traces every narration sentence back to provenance,
and gate 2 reviews the compiled course (judge flags attached) in a dedicated
course viewer with send-back-for-re-authoring. As of M5, **the last stages
are real**: GENERATING_SCRIPT deterministically normalises narration into a
speakable script (unresolved pronunciations *block* their unit),
GENERATING_ASSETS synthesises per-sentence audio with word-level timestamps
(ElevenLabs; mocked in tests/CI) into a versioned per-unit **timing
artifact**, gate 3 reviews the course in a **playable studio** (real audio,
cards firing on their word anchors, per-sentence editing with single-sentence
re-synthesis), and approval assembles the canonical Course Definition export
+ publish manifest into an immutable published version.

## State diagram

```
UPLOADED → CONVERTING → CONVERTED
  → EXTRACTING → EXTRACTED
  → OUTLINING                 (M6.5: brief-directed outline pass — approved
                                facts + cleared assets, no authoring spend)
  → OUTLINE_REVIEW            (editable outline; approve → COMPILING,
                               regenerate-with-feedback → OUTLINING)
  → COMPILING → COMPILED
  → QA_RUNNING → QA_PASSED | QA_FLAGGED
  → GATE_2_COURSE_REVIEW      (waits for decideGate(2);
                               may send back to COMPILING for re-authoring)
  → GENERATING_SCRIPT         (narration normalisation; unresolved
                               pronunciations block their unit)
  → GENERATING_ASSETS         (per-sentence TTS + timing artifacts)
  → GATE_3_PREVIEW            (playable studio; approve refuses while any
                               unit is blocked/failed; reject →
                               GATE_2_COURSE_REVIEW with reviewer notes)
  → PUBLISHING → PUBLISHED    (export + manifest assembled and verified;
                               published courses are immutable)

(any state) → FAILED with { retryable, cause }   FAILED is terminal.
```

The full map lives in [`states.ts`](./states.ts) (`ALLOWED_TRANSITIONS`).

**M4 resequencing rationale** (one-time sanctioned contract change): the old
order compiled before fact review, which meant the compiler consumed
unreviewed facts. Now source-doc fact review happens before `startRun`, so the
compiler only ever sees reviewed inventory (approved facts; excluded facts
filtered out in code). The QA judge runs on the compiled course
*before* any money is spent on TTS/assets, and `QA_FLAGGED` routes to gate 2
with the flags attached so a human decides: send flagged units back to
COMPILING for re-authoring, or approve. Gate 2 (renamed from
`GATE_2_QUIZ_REVIEW`) reviews the compiled course as a whole — narration
provenance, cards, questions, and judge flags — in the course viewer.

## Course outline step (M6.5)

After extraction, the **outline pass** (`outline-course@1`,
`compiler/outline.ts`) proposes course title,
3–7 learning outcomes, and the module/unit structure from the approved
inventory, the CLEARED asset catalogue (per-unit `mediaAssetIds`
suggestions), and the **operator brief** entered on the generate page —
source documents often contain more than one course's worth of material,
and the brief rules what this course is about. The prompt distils the
outline rules from **`docs/learning-design-blueprint.md`** (the canonical
pedagogy source): one concept per unit, 3–7 units per module, front-load
the most misunderstood concept, end modules on the highest-stakes
compliance point, orientation → application.

The outline persists on `courseOutlines` (one row per run, zod-validated
on every write) and parks at **OUTLINE_REVIEW** —
`/admin/runs/{id}/outline` — where it is fully editable (title, outcomes,
module/unit rename/reorder/delete, add units from unused concepts,
budgets, media suggestions) with the same code checks as generation, or
regenerable with feedback (feedback accumulates across attempts; a
regenerate replaces manual edits, and the UI says so). **Approval is the
only door into authoring spend**: it marks the outline approved,
transitions to COMPILING, and `runCompilationInner` consumes the stored
outline verbatim (`plansFromOutline`), skipping the inline structure LLM
pass; legacy runs without an outline fall back to the old inline pass.
The brief and per-unit suggestions also thread into every authoring
prompt. Scripts (`walkthrough.mjs`, `eval-compile.mjs`) auto-approve the
outline unedited via `pipeline/outlineReview:approveOutline`.

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
workflow continues: EXTRACTING → EXTRACTED → OUTLINING
(outline approval starts the compileAndJudge workflow)
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
- **M6 endpoints, same HMAC/202/queue/callback shape:** `POST
  /ingest-assets` (asset-library media: image normalise + thumbnail, video
  probe/caps/transcode-to-muted-mp4 + poster, zip expansion; per-file
  accepted/rejected manifest → `/converter/asset-callback`) and `POST
  /extract-pdf-images` (retroactive pdfimages pass over an already-converted
  pdf → `/converter/pdf-images-callback`). The `/convert` pdf path now runs
  the same pdfimages extraction inline, so new pdf conversions catalogue
  their embedded images like pptx decks always did. ffmpeg ships in the
  container (media caps env-tunable: `MAX_VIDEO_SECONDS`, `MAX_FILE_MB`,
  `PDF_IMAGE_MIN_PX`, …). One-shot backfills after deploy:
  `npx convex run pipeline/assetsIngest:backfillDeckExtractedAssets` and
  `…:backfillPdfImages`.

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
EXTRACTED → OUTLINING → OUTLINE_REVIEW
    │ 12. source-doc fact review already happened before `startRun`
    │     (approve/exclude on pageExtractions; safe bulk approval available)
    │ 13. approveOutline starts compileAndJudge
    ▼
COMPILING → COMPILED → QA_RUNNING → … (see "Compiler architecture" below)
```

## Compiler architecture (M4)

```
OUTLINE_REVIEW approved → compileAndJudge workflow
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
flags back into the authoring prompt). Cards render through the real
`@counseliq/cards` components (settled state) with per-template prop
validation chips.

## Script normalisation (M5)

`tts/script.ts` (`generateScripts`, deterministic — no LLM) runs at
GENERATING_SCRIPT. Every narration sentence passes through the pure rules
module `tts/normalize.ts` (tokenize → ordered matchers → en-AU expanders):

| Narration | speakText |
|-----------|-----------|
| `A$82M` | `eighty-two million Australian dollars` |
| `12.5%` | `twelve point five per cent` |
| `70,000+ nurses` | `more than seventy thousand nurses` |
| `2019–2023` | `twenty nineteen to twenty twenty-three` |
| `3 March 2024` | `the third of March twenty twenty-four` |

Three text layers per sentence, with persisted character-span alignment
between the first two and a recomputable substitution map to the third:

```
sourceText   the narration as authored (human-readable, what gate 2 reviews)
  ↓ alignment (persisted on microUnits.script)
speakText    normalised speech text (numbers as words; still human-readable)
  ↓ lexicon substitution (pure function of speakText + pronunciationLexicon)
spokenText   what is actually sent to the TTS provider at request time
```

Pronunciation respellings (`{"Bundoora": "bun-DOOR-ah"}`) are applied at
**request time** in the provider adapter — never stored in narration or
speakText. A lexicon entry whose value is the sentinel
`CONFIRM_WITH_INSTITUTION` and whose key appears in a unit's narration
**blocks that unit** (state `blocked` + a gate-3 `blocked_unit` review
item): the run proceeds for every other unit, but gate 3 cannot be approved
while any blocked unit exists. That is correct behaviour, not a failure —
the operator resolves the pronunciation (or the institution confirms it)
and the unit re-synthesises.

## Timing artifact contract

`unitTimingSchema` in `packages/course-schema/src/timing.ts` — the single
clock every downstream consumer reads. **Versioned**: the artifact carries
`version` (`TIMING_VERSION`, currently **2**); any field change bumps it and
consumers must check it before reading (the gate-3 preview surfaces an
older-version artifact as "needs re-synthesis" — the bump is inside
`unitContentHash`, so the next GENERATING_ASSETS pass rebuilds it with zero
TTS spend thanks to the sentence cache). Shape (all times integer ms on the
**unit clock** — t=0 at the start of the unit's first sentence):

```
{ version, unitKey, provider, voiceRef, model, interSentenceGapMs,
  totalDurationMs,
  sentences: [{ narrationId, speakText, audioKey,      // per-sentence mp3
                startMs, durationMs,
                words: [{ text, startMs, endMs }] }],   // word timestamps
  cardBeats: [{ cardIndex, atMs }],                     // enterAt resolved
  media: [{ cardIndex, inMs, outMs }],                  // v2: media windows
  generatedAt }
```

**v2 media windows** (M6): one entry per media card (`video-card`,
`photo-kenburns`, `image-text-card` carrying an `assetRef`). `inMs` is the
card's beat; `outMs` is the card's window end, additionally capped at
`inMs + asset durationMs` for video — trim-if-longer; a shorter clip holds
its last frame for the remainder of the card window. The player's
`deriveActiveCard` turns the active card's window into
`CardTiming.media {positionMs, durationMs}`, which is the ONLY thing that
drives the `<video>` element (CardVideo — muted always, poster until the
beat, poster under reduced motion, no internal timers).

Card beats resolve each card's `enterAt {narration, word}` anchor through
the alignment chain (original word span → speakText span → overlapping
spoken words → ms). Consumers today: the gate-3 player (drives card reveals,
captions with current-word emphasis, controls). Consumer next: the Remotion
renderer (M6) — frame → unit-clock ms → identical derivations. Stored inline
on `microUnits.timing` (validated on every write) and serialized to the
object store at publish (`manifest.units[].timingKey`).

## TTS synthesis (M5)

`tts/synthesize.ts` runs at GENERATING_ASSETS: per-unit `synthesizeUnit`
actions fan out through the `ttsPool` workpool (`TTS_PARALLELISM`, default 2
— ElevenLabs concurrency caps are low; `TTS_MODE=sequential` for tests;
`TTS_TIMEOUT_MS` default 10 min). Each unit synthesises **per narration
sentence** (neighbouring sentences passed as `previous_text`/`next_text`
prosody conditioning) via `TtsProvider` — ElevenLabs
`/v1/text-to-speech/{voice}/with-timestamps` (`tts/elevenlabs.ts`, native
fetch, retry-after-honouring backoff) or the deterministic mock
(`TTS_PROVIDER=mock` — all tests/CI; never calls ElevenLabs).

Two invalidation layers, both content-addressed:

- **`ttsSentences` cache** — `sentenceHash = sha256(spokenText | voiceId |
  model | outputFormat)`. An edited sentence re-synthesises *alone*; every
  other sentence is a cache hit (audio reused across runs and courses).
- **`microUnits.contentHash`** — hash of (speakTexts, lexicon, cards,
  voiceId, model, format, gap). An unchanged unit is skipped entirely on
  re-runs — test-proven.

Audio artifacts are content-addressed mp3s (`sha256/{hash}.mp3`) in the
object store; word timestamps derive from the provider's character
alignment. Voice resolution: `ELEVENLABS_VOICE_ID` env (dev override) >
`institutions.voiceConfig.voiceId` > `TTS_NOT_CONFIGURED`. Failure
semantics: a failed unit carries `microUnits.error` + a gate-3 `failed_unit`
item (retryable from the studio) and the run still parks at GATE_3_PREVIEW;
the run only goes FAILED when *zero* units succeeded (systemic cause).

Every synthesis writes a `ttsCalls` row (runId, stage, voice, model,
characters, costUsd, latencyMs). **`ttsCalls.costUsd` is estimated from
`tts/pricing.ts`** — ElevenLabs returns no per-request cost; this is the one
sanctioned deviation from the llmCalls provider-reported invariant. Keep the
price sheet's tier rate and `verifiedAt` honest.

## Player architecture (M5)

The gate-3 studio (`/admin/runs/[id]/gate-3`) embeds the course player from
`@counseliq/admin` driving `@counseliq/cards`:

- **Cards are pure functions of `(props, timing, theme)`** — the timing
  contract is `{ localMs, progress, beatsRevealed, reducedMotion }` and a
  mechanical no-timer test bans timers, rAF, wall-clocks, hooks and CSS
  animation strings inside card components. Rationale: the same components
  must render deterministically in the browser player *and* under Remotion's
  frame-by-frame capture in M6 (frame → progress → identical pixels).
- **The audio element is the only clock.** Per-sentence mp3s play through an
  A/B pair of HTMLAudioElements (next sentence preloaded); the unit clock is
  strictly `sentence.startMs + audioEl.currentTime`, artifact gaps are
  waited out, and every derivation (active card, `beatsRevealed`, caption
  word emphasis) is a pure function of that clock over the timing artifact.
  None of the design mockup's speechSynthesis/setTimeout estimation
  survives.
- **Studio navigation**: module rail (state chips, blocked/failed badges),
  click any unit, click any phase (hook → content → retrieve → anchor),
  scrub within content, inspect card props, edit narration sentences —
  a save re-normalises the sentence and re-synthesises exactly that
  sentence, and the player reflects the new audio reactively.
- **Reduced motion** is honoured end-to-end: cards settle instantly, no
  autoplaying pan, captions still track words.

## Publish (M5)

Gate-3 approval transitions to **PUBLISHING** and runs `publish.ts
runPublish`:

1. Preconditions (`publishCore.ts`, pure): every unit `assets_ready` with a
   versioned timing artifact and per-sentence audio coverage; no blocked or
   errored units.
2. `reconstructCourseDefinition` over the normalised tables →
   `parseCourseDefinition` (the canonical export must be schema-valid,
   cross-refs included).
3. Content-addressed artifacts: `export.json` (key = `sha256/{specHash}`),
   one timing JSON per unit, and `manifest.json` — validated by
   `publishManifestSchema` (`packages/course-schema/src/publish-manifest.ts`):
   per-unit audio keys + timingKey, theme tokens, the voice actually used
   for synthesis, prompt/model versions, specHash, course version, and a
   deduped `artifactKeys` integrity list.
4. Audio keys are HEAD-checked against the store before anything is written
   (skipped under `TTS_PROVIDER=mock`, which never uploads audio bytes).
5. `finalizePublish` (transactional): one immutable `courseVersions` row +
   `courses.status = "published"` + every unit frozen. Idempotent — a
   crash-retry with the same specHash lands on the existing row; a
   *different* specHash at the same version is `PUBLISH_VERSION_CONFLICT`,
   never an overwrite. **Published courses are immutable**: every
   content-editing mutation refuses with `COURSE_PUBLISHED`. A re-publish is
   a new compile → new `courses.version` → new snapshot row.

Serving today: `getPublishedCourse` (admin query) returns the snapshot;
artifact keys presign through the existing `adminPresignGetBatch`. A
service-token HTTP endpoint for the learner app and Remotion render workers
is the M6 follow-up. Round-trip verification: `verifyPublishedArtifacts`
re-parses the stored manifest and HEADs every `artifactKeys` entry — the
walkthrough and `eval:assets` both run it.

## Asset library & media enrichment (M6)

One institution-scoped **media catalogue** on the `assets` table: images and
videos, from two origins — `uploaded` (the `/admin/assets` library page:
browser sha256 → presigned PUT → converter `/ingest-assets`) and
`deck_extracted` (pptx embedded images since M2; pdf embedded images since
M6 via `pdfimages`, filtered by a 200px shorter-edge floor + 5:1 aspect cap,
SMask pairs alpha-merged best-effort, and images repeating on ≥3 distinct
pages routed to the theme's logoCandidates instead of the catalogue).
Ingestion normalises images (capped longest edge + thumbnail) and
transcodes video to **muted** H.264 MP4 (`-an` strips any soundtrack —
narration is the only audio in a course, mechanically) with a poster frame;
caps (60s / 500MB / 1080p, env-tunable) reject absurd inputs per-file with
operator-readable reasons.

**Tagging** (`tag-asset@1`, vision, prompt-versioned): caption, tags,
subjects, setting, text-in-image, qualityScore, suggestedUses, and a
CONSERVATIVE `identifiablePeople` (any visible face ⇒ true). Code floors
the model cannot cross: the output schema has **no rights field**, and
`identifiablePeople` ratchets upward only — `adminSetIdentifiablePeople`
(a human) is the sole lowering path. Re-tag = bump the prompt version (the
per-asset `tagPromptVersion` stamp mismatches) or `adminRetagAsset`.

**The rights model — the load-bearing invariant.** Every asset lands with
`rights: "unknown"` and nothing but the operator's declaration
(`adminDeclareAssetRights`, single or bulk, stamped with declarer + time)
can change that. "Usable" is defined ONCE, in code
(`isAssetCleared` in `assetsCatalogue.ts`): rights ∈ {institution_owned,
licensed} AND (no identifiable people OR consent confirmed). The compiler's
catalogue filter, the gate-2 swap picker, and the library page badge all
import that one predicate — an unknown-rights asset cannot appear in any
course **mechanically**: the model never sees its id (the compact catalogue
is filtered in code before prompting), `validateAssetRefs` rejects it
post-parse if hallucinated, and the swap mutation refuses it.

**Asset-aware compilation.** `getClearedCatalogueForRun` injects a compact,
deterministically-ordered catalogue (id, kind, caption, tags, aspect,
duration, suggestedUses, deckPage) into `author-unit@2`; its hash joins the
authoring cacheKey so new uploads/declarations re-author on recompile.
Post-parse rules ride the existing retry-with-errors machinery:
`validateAssetRefs` (dangling / uncleared / kind mismatch /
image-text-card-portrait) and `validateMediaPacing` — **≥1 media card per
3 content cards** where the cleared catalogue makes it satisfiable (capped
by availability, min 1 from 3 cards), and never two consecutive text-dense
cards while media headroom remains. An empty catalogue disables the rule:
courses compile media-free, safely. The judge (`judge-course@2`) sees each
media card's asset caption and flags `media-irrelevant` (warning — review
material, never an error).

**Gate-2/3 asset swap, no re-TTS.** `adminSwapCardAsset` re-validates
(cleared + fit), patches the card's `assetRef`, and recomputes ONLY the
timing artifact's media windows. `unitContentHash` strips visual-only props
(`assetRef`/`imageRef`) before hashing, so the hash — and every sentence's
audio — is untouched by construction; test-proven byte-identical audioKeys
and zero new ttsCalls across a swap.

**eval:compile** ingests fixture media, waits for tagging, declares rights
as `eval:auto` (same audited mutation fields), and adds pass/fail media
assertions: every assetRef cleared + kind/aspect-correct re-checked against
the live library (zero unknown-rights leakage), pacing satisfied, plus
printed media stats (media cards, distinct assets, video count,
media-irrelevant flags).

## Demo script (10-minute pilot demo)

1. `TTS_PROVIDER=mock npm run dev:stack` for a free rehearsal, or set
   `ELEVENLABS_API_KEY` (+ voice, see Operator setup) and drop the env var
   for real voice.
2. In another terminal: `npm run walkthrough:local -- --yes --pause-at-gate-3`.
   The script prints the cost estimate (LLM + TTS characters/$), uploads the
   fixture docs, and drives conversion → extraction → outline review
   (auto-approved) → compile → QA → the TTS estimate → gate 2 → synthesis.
3. While it runs, open `/admin/runs/{id}/gate-2` to show the
   human review gate (the script auto-approves it).
4. At gate 3 the script pauses and prints the player URL. Open it: **watch a
   unit play** — real voice, cards firing on their word anchors, captions
   with current-word emphasis, hook and retrieve questions inline.
5. Edit one narration sentence in the studio → the unit re-synthesises just
   that sentence → replay it.
6. Approve gate 3 in the studio (or `npm run walkthrough:local -- --yes
   --resume <runId>`): the run publishes, and the script prints the version,
   specHash, artifact verification, per-stage timings, and the LLM/TTS cost
   split.

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
tokensIn/Out, provider-reported costUsd, latencyMs). Every TTS synthesis
writes a `ttsCalls` row (runId, stage, voice, model, characters, costUsd,
latencyMs) — TTS costUsd is **estimated** from [`tts/pricing.ts`](./tts/pricing.ts)
because ElevenLabs reports no per-request cost. `getRunCost(runId)` (admin)
/ `getRunCostInternal` return LLM totals itemized by stage and model plus a
`tts` block and `grandTotalUsd` (LLM + TTS); the walkthrough prints the
split. [`llm/pricing.ts`](./llm/pricing.ts) is an operator-verified price
sheet used only for pre-run estimates in `npm run eval` /
`npm run eval:compile`; actual LLM cost always comes from OpenRouter usage
accounting.

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
auto-approves the outline the same way `walkthrough.mjs` does, waits for
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

### Assets eval (`npm run eval:assets`) — the M5 exit test

```bash
npm run eval:compile -- --yes            # first: park a run at gate 2
npm run eval:assets -- --yes             # then: TTS + publish on that run
npm run eval:assets -- --yes --run <id>  # target a specific gate-2 run
```

Chains off a compiled run so you never pay for compile twice. Prints the TTS
character/cost estimate and requires `--yes`, approves gate 2, waits for
synthesis, and scores: every non-blocked unit `assets_ready` with a
versioned timing artifact, every narration sentence has a per-sentence audio
artifact, card beats resolved for every card; blocked/failed units fail the
eval. Then approves gate 3, waits for PUBLISHED, and verifies the round-trip
(`courseVersions` snapshot + every manifest artifact key HEAD-checked in the
store). Appends a `kind:"assets"` row to `eval-history.jsonl` with
characters, TTS cost vs estimate, and the publish specHash.

## Invariants

- **All `runs.state` writes go through `transitionRun`** (well,
  `applyRunTransition` in [`transitions.ts`](./transitions.ts), which the
  mutation wraps). It validates against the transition map, patches the run,
  and journals a `runEvents` row. The one exception is run *creation*:
  `startRun` inserts the run already in `UPLOADED`.
- Gates only advance via `decideGate` (human/admin action) — workflows park
  runs at gate states and stop.
- Rejecting gate 2 transitions the run to `FAILED { retryable: true }`.
  Rejecting gate 3 routes back to `GATE_2_COURSE_REVIEW` with the reviewer's
  notes journaled and a pending `gate3_rejection` review item.
- Gate 3 cannot be approved while any unit is `blocked` (unresolved
  pronunciation) or carries a TTS `error` (`UNITS_BLOCKED`).
- **Published courses are immutable** — every content-editing mutation
  refuses with `COURSE_PUBLISHED`; each publish is one immutable
  `courseVersions` row plus content-addressed artifacts; a re-publish is a
  new version, never an overwrite.
- The timing artifact is versioned (`TIMING_VERSION`) — consumers check
  `version` before reading; any shape change bumps it.
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
| `reviewItems.ts` | Gate-3 review item helpers (`blocked_unit`, `failed_unit`) + list query |
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
| `llmCalls.ts` | `recordLlmCall`, `getRunCost` (LLM + TTS split, `grandTotalUsd`), cost estimators |
| `tts/normalize.ts` | Pure narration → speakText normaliser (en-AU rules + alignment) |
| `tts/lexicon.ts` | Pronunciation substitution map, sentinel detection, span projection |
| `tts/script.ts` | `generateScripts` — the GENERATING_SCRIPT stage (blocked units) |
| `tts/provider.ts` / `tts/elevenlabs.ts` / `tts/mock.ts` | `TtsProvider` contract + ElevenLabs with-timestamps adapter + deterministic mock |
| `tts/models.ts` / `tts/pricing.ts` | TTS env routing (`TTS_*`) + estimated price sheet |
| `tts/beats.ts` | Word timestamps, unit-clock assembly, card-beat resolution |
| `tts/synthesize.ts` | `synthesizeUnit` + `runAssetGeneration` via the `ttsPool` workpool |
| `tts/data.ts` / `tts/calls.ts` | Synthesis data layer, `ttsSentences` cache, `recordTtsCall`, `estimateTtsCostForRun` |
| `tts/preview.ts` | `adminGetRunPreview` — the gate-3 studio's data source |
| `tts/edit.ts` | `adminUpdateNarrationSentence` (single-sentence re-synthesis) + `adminRetryUnitTts` |
| `publishCore.ts` | Pure publish builders: spec hash, preconditions, manifest assembly |
| `publish.ts` | `runPublish` + `verifyPublishedArtifacts` (`"use node"`, object store) |
| `publishedCourses.ts` | `finalizePublish`, `getPublishedCourse`, `courseVersions` snapshots |
| `prompts/` | Versioned prompt `.md` files + generated `index.ts` |
| `queries.ts` | `getRun`, `listRunsByState`, `gateQueue`, `listSourceDocs`, `getSourceDoc` (admin) + internals |
| `seed.ts` | Seeds the fictional "Banksia University" for the walkthrough (optional `voiceConfig`) |
| `../http.ts` | `POST /converter/callback` http action |

Tests: [`../pipeline.test.ts`](../pipeline.test.ts) (transitions/gates,
resequenced map), [`../ingestion.test.ts`](../ingestion.test.ts) (callback
HMAC/validation/idempotency),
[`../extraction.test.ts`](../extraction.test.ts) (inventory idempotency,
source-doc fact bulk approval, page cache),
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
(mechanical pre-pass, verdict derivation — mocked LLM). M5 adds
[`tts/normalize.test.ts`](./tts/normalize.test.ts) /
[`tts/lexicon.test.ts`](./tts/lexicon.test.ts) (rule table, alignment
invariants, substitution), [`tts/elevenlabs.test.ts`](./tts/elevenlabs.test.ts)
/ [`tts/beats.test.ts`](./tts/beats.test.ts) (adapter retries — mocked
fetch; word/beat derivation), [`../tts.test.ts`](../tts.test.ts) (script
stage, blocked units), [`../ttsSynthesis.test.ts`](../ttsSynthesis.test.ts)
(synthesis e2e with the mock provider — **hash-skip and single-sentence
invalidation are test-proven here**), [`../gate3.test.ts`](../gate3.test.ts)
(gate-3 approval blocking, reject-with-notes, edit loop),
[`publishCore.test.ts`](./publishCore.test.ts) and
[`../publish.test.ts`](../publish.test.ts) (manifest determinism,
preconditions, finalize idempotency, immutability guards, export
round-trip).

Admin UI: `/admin/source-docs` (list → per-doc page grid with PNG, text,
notes, provenance ID, theme candidates), `/admin/runs/[id]` (state, events,
itemized LLM cost, inventory browser with claim-class chips and flagged
filter), `/admin/runs/[id]/gate-2` (course viewer — see "Gate-2
course viewer" above), `/admin/runs/[id]/gate-3` (the playable studio —
see "Player architecture" above), and `/ui/cards` (dev gallery: all 21 card
templates, theme/reduced-motion toggles, timing scrubber).

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
5. **TTS env (M5)**: `ELEVENLABS_API_KEY` (required for live voice), and
   optionally `ELEVENLABS_VOICE_ID` (dev override; production voice IDs
   belong on `institutions.voiceConfig` — seed one with
   `npx convex run pipeline/seed:seed '{"name": "…", "voiceConfig": {"provider": "elevenlabs", "voiceRef": "…", "voiceId": "…"}}'`),
   `TTS_MODEL` (default `eleven_multilingual_v2`), `TTS_PARALLELISM`
   (default 2 — mind your plan's concurrency cap), `TTS_MODE=sequential`,
   `TTS_TIMEOUT_MS` (default 10 min), and `TTS_PROVIDER=mock` for free
   deterministic synthesis (tests/CI/rehearsals). `dev:stack` forwards all
   of these too. Keep the tier rate in `tts/pricing.ts` honest — TTS costs
   are estimated, not provider-reported.
6. **Fixture docs** — place two real source documents at
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
npm run walkthrough -- --yes       # upload fixtures → conversion → extraction →
                                   # compile+QA → TTS → gate 3 → PUBLISHED
npm run walkthrough -- --yes --pause-at-gate-3   # stop at the playable studio
npm run walkthrough -- --yes --resume <runId>    # continue a parked run
npm run walkthrough -- --skip-docs # M1-style run, conversion phase no-ops through
npm test                           # course-schema + cards + converter + convex suites
```

Requires a converter the cloud deployment can reach (e.g. Fly.io) and the env
vars from "Operator setup" set on that deployment.

## What is stubbed, and which milestone makes it real

| Stub | Today (M6) | Becomes real in |
|------|------------|-----------------|
| `convert` stage | **real** (services/converter) | — |
| `extract` stage | **real** (per-page LLM extraction → knowledge inventory) | — |
| `compile` stage | **real** (two-pass compiler → Course Definition, code-enforced rules) | — |
| `qa` stage | **real** (adversarial judge, provenance tracing, `QA_FLAGGED` routing) | — |
| `generate-script` / `generate-assets` stages | **real** (normalisation, per-sentence TTS, timing artifacts) | — |
| Gate-1 review items | **real** (one per flagged fact, per-item resolution) | — |
| Gate-2 review | **real** (course viewer + send-back re-authoring, real card renders) | — |
| Gate-3 review | **real** (playable studio, blocked/failed enforcement, sentence editing) | — |
| Publish | **real** (export + manifest + immutable `courseVersions`) | — |
| `llmCalls` / `ttsCalls` tables | **real** (every call recorded; LLM/TTS cost split) | — |
| Asset library / media enrichment | **real** (ingest + tagging + rights model + pacing + muted video playback) | — |
| Video rendering (export) | none — the player is live-DOM only; timing v2 media windows are designed for frame capture | later milestone (Remotion consumes the timing artifacts + publish manifest) |
| Learner-facing serving | admin query + presign only | later milestone — service-token HTTP endpoint for the learner app / render workers |
| Roleplay assessment | schema field only (`assessment`) | later milestone |
| Adaptive scheduler / credential pulses | not started | later milestone |
