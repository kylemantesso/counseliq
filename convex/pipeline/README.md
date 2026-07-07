# CounselIQ pipeline (Milestone 2 — real ingestion)

Durable state machine that walks a course-generation "run" from upload to
publication, pausing at three human review gates. As of M2, **ingestion is
real**: uploaded source documents (pptx/pdf) are converted by an external
converter service into per-page artifacts — rendered PNG, extracted text +
speaker notes, embedded images, candidate brand theme — content-addressed in
an S3-compatible object store, with every artifact carrying a provenance ID.
EXTRACTING onward remains stubbed (M3).

## State diagram

```
UPLOADED → CONVERTING → CONVERTED
  → EXTRACTING → EXTRACTED → COMPILING → COMPILED
  → GATE_1_KNOWLEDGE_REVIEW   (waits for decideGate(1))
  → GENERATING_SCRIPT → GENERATING_ASSETS → QA_RUNNING → QA_PASSED
  → GATE_2_QUIZ_REVIEW        (waits for decideGate(2))
  → GATE_3_PREVIEW            (waits for decideGate(3))
  → PUBLISHED

(any state) → FAILED with { retryable, cause }   FAILED is terminal.
```

The full map lives in [`states.ts`](./states.ts) (`ALLOWED_TRANSITIONS`).

## Converter architecture

```
walkthrough / upload client
    │ 1. presignPut (objectStore.ts) → PUT source doc to object store
    │ 2. registerSourceDoc × N, startRun (docs linked to run)
    ▼
Convex: ingestAndCompile workflow
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
workflow continues: EXTRACTING → … (stubs) → gates → PUBLISHED
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
| `workflows.ts` | `ingestAndCompile`, `generateAssets`, `publishPhase` (durable, via `@convex-dev/workflow`) |
| `runs.ts` | `startRun`, `decideGate` (internal) + `adminStartRun`, `adminDecideGate` (public, admin-gated) |
| `reviewItems.ts` | Placeholder review-item insertion per gate |
| `queries.ts` | `getRun`, `listRunsByState`, `gateQueue`, `listSourceDocs`, `getSourceDoc` (admin) + internals |
| `seed.ts` | Seeds "Example University" for the walkthrough |
| `../http.ts` | `POST /converter/callback` http action |

Tests: [`../pipeline.test.ts`](../pipeline.test.ts) (transitions/gates) and
[`../ingestion.test.ts`](../ingestion.test.ts) (callback HMAC/validation/
idempotency).

The admin inspection UI lives at `/admin/source-docs` (list → per-doc page
grid with PNG, text, notes, provenance ID, theme candidates).

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
4. **Fixture docs** — place two real source documents at
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

| Stub | Today (M2) | Becomes real in |
|------|------------|-----------------|
| `convert` stage | **real** (services/converter) | — |
| `extract` stage | sleeps 1s | M3 — LLM extraction over converted slides |
| `compile` stage | sleeps 1s | M3 — LLM compilation into `inventoryItems` + Course Definition (`@counseliq/course-schema`) |
| `generate-script` / `generate-assets` stages | sleep 1s | M3 — script generation, TTS, `microUnits` populated |
| `qa` stage | sleeps 1s | M3 — automated QA over generated units |
| Gate review items | hard-coded placeholders | M3+ — real knowledge facts, quiz questions, and course previews |
| `llmCalls` table | exists, unused | M3 — cost tracking per LLM call |
| Review UI | source-doc inspector only | M4 — full review-gate screens |
