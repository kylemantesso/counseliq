# CounselIQ pipeline (Milestone 1 skeleton)

Durable state machine that walks a course-generation "run" from upload to
publication, pausing at three human review gates. In M1 every worker stage is
a no-op (sleep ~1s + log); the state machine, tables, gates, and walkthrough
are real.

## State diagram

```
UPLOADED → EXTRACTING → EXTRACTED → COMPILING → COMPILED
  → GATE_1_KNOWLEDGE_REVIEW   (waits for decideGate(1))
  → GENERATING_SCRIPT → GENERATING_ASSETS → QA_RUNNING → QA_PASSED
  → GATE_2_QUIZ_REVIEW        (waits for decideGate(2))
  → GATE_3_PREVIEW            (waits for decideGate(3))
  → PUBLISHED

(any state) → FAILED with { retryable, cause }   FAILED is terminal.
```

The full map lives in [`states.ts`](./states.ts) (`ALLOWED_TRANSITIONS`).

## Invariants

- **All `runs.state` writes go through `transitionRun`** (well,
  `applyRunTransition` in [`transitions.ts`](./transitions.ts), which the
  mutation wraps). It validates against the transition map, patches the run,
  and journals a `runEvents` row. The one exception is run *creation*:
  `startRun` inserts the run already in `UPLOADED`.
- Gates only advance via `decideGate` (human/admin action) — workflows park
  runs at gate states and stop.
- Rejecting a gate transitions the run to `FAILED { retryable: true }`.

## Files

| File | Purpose |
|------|---------|
| `states.ts` | State + gate types, `ALLOWED_TRANSITIONS`, `GATE_STATES` |
| `transitions.ts` | `transitionRun` — the single writer of `runs.state` |
| `steps.ts` | `runNoopStage` — M1 stand-in for real pipeline work |
| `workflows.ts` | `ingestAndCompile`, `generateAssets`, `publishPhase` (durable, via `@convex-dev/workflow`) |
| `runs.ts` | `startRun`, `decideGate` (internal) + `adminStartRun`, `adminDecideGate` (public, admin-gated) |
| `reviewItems.ts` | Placeholder review-item insertion per gate |
| `queries.ts` | `getRun`, `listRunsByState`, `gateQueue` (admin) + `getRunInternal` (scripts/tests) |
| `seed.ts` | Seeds "Example University" for the walkthrough |

Tests live in [`../pipeline.test.ts`](../pipeline.test.ts) (convex-test needs
the module map rooted at `convex/`).

## Driving it

```bash
npm run walkthrough   # seed → startRun → poll → approve gates → PUBLISHED
npm test              # course-schema vitest + convex-test transition tests
```

## What is stubbed, and which milestone makes it real

| Stub | Today (M1) | Becomes real in |
|------|------------|-----------------|
| `extract` stage | sleeps 1s | M2 — document conversion (Fly.io converter, `sourceDocs`/`slides` populated) |
| `compile` stage | sleeps 1s | M2/M3 — LLM compilation into `inventoryItems` + Course Definition (`@app-template/course-schema`) |
| `generate-script` / `generate-assets` stages | sleep 1s | M3 — Anthropic script generation, ElevenLabs TTS, `microUnits`/`assets` populated |
| `qa` stage | sleeps 1s | M3 — automated QA over generated units |
| Gate review items | hard-coded placeholders | M2+ — real knowledge facts, quiz questions, and course previews |
| `llmCalls` table | exists, unused | M2+ — cost tracking per LLM call |
| `assets` table | exists, unused | M3 — object storage keys for audio/images |
| `courses` / `microUnits` / `questions` tables | exist, unused | M2/M3 — compiler output |
| Review UI | none (use `npx convex run` / dashboard) | M4 — admin screens in `packages/app` |
