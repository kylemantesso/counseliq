import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const notificationTypeValidator = v.union(
  v.literal("admin_test"),
  v.literal("welcome")
);

export const notificationChannelValidator = v.union(
  v.literal("email"),
  v.literal("push")
);

export const notificationDeliveryStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("skipped")
);

// --- CounselIQ pipeline validators ---

export const runStateValidator = v.union(
  v.literal("UPLOADED"),
  v.literal("CONVERTING"),
  v.literal("CONVERTED"),
  v.literal("EXTRACTING"),
  v.literal("EXTRACTED"),
  v.literal("GATE_1_KNOWLEDGE_REVIEW"),
  /** M6.5: outline pass running (brief + approved facts + cleared assets). */
  v.literal("OUTLINING"),
  /** M6.5: outline parked for operator editing/approval. */
  v.literal("OUTLINE_REVIEW"),
  v.literal("COMPILING"),
  v.literal("COMPILED"),
  v.literal("QA_RUNNING"),
  v.literal("QA_PASSED"),
  v.literal("QA_FLAGGED"),
  v.literal("GATE_2_COURSE_REVIEW"),
  v.literal("GENERATING_SCRIPT"),
  v.literal("GENERATING_ASSETS"),
  v.literal("GATE_3_PREVIEW"),
  /** M5: gate-3 approval accepted; the publish workflow is assembling and
   *  uploading the export + manifest artifacts. */
  v.literal("PUBLISHING"),
  v.literal("PUBLISHED"),
  v.literal("FAILED")
);

export const reviewGateValidator = v.union(
  v.literal(1),
  v.literal(2),
  v.literal(3)
);

export const reviewItemStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected")
);

export const sourceDocStatusValidator = v.union(
  v.literal("pending"),
  v.literal("converting"),
  v.literal("converted"),
  v.literal("failed")
);

export const microUnitStateValidator = v.union(
  v.literal("draft"),
  /** M5: narration references a lexicon term whose pronunciation is the
   *  CONFIRM_WITH_INSTITUTION sentinel — blocks gate 3 until resolved. */
  v.literal("blocked"),
  v.literal("script_ready"),
  v.literal("assets_ready"),
  v.literal("qa_passed"),
  v.literal("published")
);

export const courseStatusValidator = v.union(
  v.literal("draft"),
  v.literal("in_review"),
  v.literal("published")
);

/**
 * Candidate brand theme: `ooxml` = extracted by the converter from pptx;
 * `llm-inferred` = vision-model candidates for pdf-native docs (M3).
 * Optional to tolerate rows written before the method field existed.
 */
export const candidateThemeValidator = v.object({
  method: v.optional(
    v.union(v.literal("ooxml"), v.literal("llm-inferred"))
  ),
  colors: v.array(v.string()),
  fonts: v.array(v.string()),
  logoCandidates: v.array(v.string()),
});

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.string(),
    createdAt: v.number(),
    isAdmin: v.optional(v.boolean()),
  })
    .index("by_token_identifier", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tasks: defineTable({
    userId: v.id("users"),
    title: v.string(),
    done: v.boolean(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  pushTokens: defineTable({
    userId: v.id("users"),
    token: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android")),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["token"]),

  notificationPreferences: defineTable({
    userId: v.id("users"),
    emailEnabled: v.boolean(),
    pushEnabled: v.boolean(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  notificationDeliveries: defineTable({
    userId: v.id("users"),
    type: notificationTypeValidator,
    channel: notificationChannelValidator,
    status: notificationDeliveryStatusValidator,
    idempotencyKey: v.string(),
    scheduledFor: v.number(),
    payload: v.any(),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    processingStartedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_status_scheduled", ["status", "scheduledFor"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_user", ["userId"]),

  appConfig: defineTable({
    minimumVersionIos: v.optional(v.string()),
    minimumVersionAndroid: v.optional(v.string()),
    updatedAt: v.number(),
  }),

  // --- CounselIQ pipeline tables (Milestone 1) ---

  institutions: defineTable({
    name: v.string(),
    brandTokens: v.any(),
    pronunciationLexicon: v.any(),
    market: v.string(),
    /**
     * Brand narrator voice (M5). `voiceRef` is the stable brand-level name
     * written into CourseDefinition.voice; `voiceId` is the TTS provider's
     * voice ID (never a secret, safe to store).
     */
    voiceConfig: v.optional(
      v.object({
        provider: v.string(),
        voiceRef: v.string(),
        voiceId: v.string(),
      })
    ),
  }),

  sourceDocs: defineTable({
    institutionId: v.id("institutions"),
    // Linked when a run starts; a run may ingest multiple source docs.
    runId: v.optional(v.id("runs")),
    kind: v.string(),
    objectKey: v.string(),
    shape: v.optional(v.string()),
    status: sourceDocStatusValidator,
    themeExtracted: v.optional(v.boolean()),
    // Populated by the conversion callback.
    sourceDocHash: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    theme: v.optional(v.union(candidateThemeValidator, v.null())),
  })
    .index("by_institution", ["institutionId"])
    .index("by_run", ["runId"]),

  slides: defineTable({
    sourceDocId: v.id("sourceDocs"),
    n: v.number(),
    pngKey: v.string(),
    thumbKey: v.optional(v.string()),
    text: v.string(),
    notes: v.string(),
    /** Content hash of the rendered page PNG. */
    hash: v.string(),
    /** Provenance ID: doc:{sourceDocId}:page:{n}. */
    provenanceId: v.optional(v.string()),
    embeddedImages: v.optional(
      v.array(
        v.object({
          key: v.string(),
          width: v.number(),
          height: v.number(),
          /** Thumbnail key (emitted by M6+ converters). */
          thumbKey: v.optional(v.string()),
        })
      )
    ),
  })
    .index("by_source_doc", ["sourceDocId"])
    .index("by_source_doc_and_n", ["sourceDocId", "n"]),

  inventoryItems: defineTable({
    runId: v.id("runs"),
    /** "concept" | "fact" | "entity" | "quote" (inventoryItemSchema.type). */
    kind: v.string(),
    /** The full InventoryItem (validated against the shared Zod contract). */
    body: v.any(),
    /** Facts only. */
    claimClass: v.optional(v.string()),
    /** Page provenance IDs: doc:{sourceDocId}:page:{n}. */
    provenance: v.array(v.string()),
    flagged: v.boolean(),
    flagReason: v.optional(v.string()),
    /** Set at gate-1 review; excluded facts are invisible to the compiler. */
    excluded: v.optional(v.boolean()),
  })
    .index("by_run", ["runId"])
    .index("by_run_and_flagged", ["runId", "flagged"]),

  /**
   * Per-page extraction cache: re-runs with an unchanged page (same content
   * hash), prompt version, and model reuse the stored result instead of
   * calling the LLM again.
   */
  pageExtractions: defineTable({
    sourceDocId: v.id("sourceDocs"),
    n: v.number(),
    /** `{pageHash}:{promptVersionTag}:{model}` */
    cacheKey: v.string(),
    /** LlmPageExtraction after code-level flag floor + provenance stamping. */
    result: v.any(),
  }).index("by_source_doc_and_n", ["sourceDocId", "n"]),

  /**
   * The course outline (M6.5): the structure pass's output, persisted so
   * the operator can edit it at OUTLINE_REVIEW before any authoring spend.
   * `modules` is zod-validated against llmCourseOutlineSchema's module
   * shape on every write (saveCourseOutline / adminUpdateOutline). One row
   * per run; regenerations and edits patch it in place.
   */
  courseOutlines: defineTable({
    runId: v.id("runs"),
    /** Operator brief copied from the run at generation time. */
    brief: v.optional(v.string()),
    courseTitle: v.string(),
    learningOutcomes: v.array(v.string()),
    modules: v.any(),
    /** "draft" (editable) | "approved" (consumed by compilation). */
    status: v.string(),
    generatedAt: v.number(),
    promptVersion: v.string(),
    model: v.string(),
    editedAt: v.optional(v.number()),
    editedBy: v.optional(v.string()),
    /** Operator regenerate-with-feedback notes, oldest first. */
    regenFeedback: v.optional(v.array(v.string())),
  }).index("by_run", ["runId"]),

  runs: defineTable({
    institutionId: v.id("institutions"),
    courseId: v.optional(v.id("courses")),
    state: runStateValidator,
    promptVersions: v.any(),
    /** M6.5: operator brief directing the course's purpose and outcomes. */
    brief: v.optional(v.string()),
    error: v.optional(
      v.object({
        retryable: v.boolean(),
        cause: v.string(),
      })
    ),
  }).index("by_state", ["state"]),

  runEvents: defineTable({
    runId: v.id("runs"),
    fromState: runStateValidator,
    toState: runStateValidator,
    actor: v.string(),
    detail: v.optional(v.string()),
  }).index("by_run", ["runId"]),

  courses: defineTable({
    institutionId: v.id("institutions"),
    title: v.string(),
    level: v.number(),
    version: v.number(),
    status: courseStatusValidator,
    specHash: v.optional(v.string()),
    /**
     * Course-level CourseDefinition fields that don't live on unit rows
     * ($schema, courseId slug, badge, voice, assessment, _pipelineNotes, …)
     * so the definition reconstructs losslessly from DB rows.
     */
    definitionMeta: v.optional(v.any()),
    /** Course-level QA verdict (judge pass/fail, courseFlags, versions). */
    qa: v.optional(v.any()),
  }).index("by_institution", ["institutionId"]),

  microUnits: defineTable({
    courseId: v.id("courses"),
    moduleKey: v.string(),
    /** Module title (kept per-unit so reconstruction is lossless). */
    moduleTitle: v.optional(v.string()),
    unitKey: v.string(),
    concept: v.string(),
    narration: v.any(),
    cards: v.any(),
    /**
     * Unit-level definition fields: secondsBudget, hook, retrieve refs,
     * anchor, conceptKey, and (module, unit) ordering.
     */
    meta: v.optional(v.any()),
    contentHash: v.optional(v.string()),
    audioKey: v.optional(v.string()),
    timing: v.optional(v.any()),
    /** UnitScript (M5): validated against unitScriptSchema in code. */
    script: v.optional(v.any()),
    /** Per-unit TTS failure marker (M5): the run still parks at gate 3;
     *  the operator retries the unit from the review UI. */
    error: v.optional(
      v.object({
        retryable: v.boolean(),
        cause: v.string(),
      })
    ),
    qa: v.optional(v.any()),
    state: microUnitStateValidator,
  }).index("by_course", ["courseId"]),

  /**
   * Per-unit authoring cache (M4 compiler): re-runs with an unchanged unit
   * plan + facts, prompt version, and model reuse the stored result instead
   * of calling the LLM again. Failed authorings store an error marker and
   * are re-attempted on the next compile.
   */
  unitAuthorings: defineTable({
    runId: v.id("runs"),
    unitId: v.string(),
    cacheKey: v.string(),
    result: v.any(),
  }).index("by_run_and_unit", ["runId", "unitId"]),

  questions: defineTable({
    courseId: v.id("courses"),
    conceptTag: v.string(),
    body: v.any(),
    irtParams: v.optional(v.any()),
  }).index("by_course", ["courseId"]),

  reviewItems: defineTable({
    runId: v.id("runs"),
    gate: reviewGateValidator,
    kind: v.string(),
    payload: v.any(),
    status: reviewItemStatusValidator,
    reviewer: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    /** Gate-1 items link back to the flagged fact they review. */
    inventoryItemId: v.optional(v.id("inventoryItems")),
  })
    .index("by_run", ["runId"])
    .index("by_run_and_gate", ["runId", "gate"])
    .index("by_gate_and_status", ["gate", "status"]),

  llmCalls: defineTable({
    /** Absent for run-less workloads (institution-scoped asset tagging). */
    runId: v.optional(v.id("runs")),
    institutionId: v.optional(v.id("institutions")),
    stage: v.string(),
    promptVersion: v.string(),
    model: v.string(),
    tokensIn: v.number(),
    tokensOut: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_institution", ["institutionId"]),

  /**
   * Per-sentence TTS cache (M5): content-addressed by the SPOKEN text (post
   * lexicon substitution) + voice + model + output format, so an edited
   * sentence — or a lexicon change affecting it — re-synthesises alone and
   * everything else is reused across runs and courses.
   */
  ttsSentences: defineTable({
    /** sha256("tts:v1|" + spokenText + "|" + voiceId + "|" + model + "|" + outputFormat) */
    sentenceHash: v.string(),
    /** Object-store key of the mp3: sha256/{sha256(audioBytes)}.mp3 */
    audioKey: v.string(),
    durationMs: v.number(),
    /** Word timestamps; charStart/charEnd are offsets into the SPOKEN text. */
    words: v.array(
      v.object({
        text: v.string(),
        startMs: v.number(),
        endMs: v.number(),
        charStart: v.number(),
        charEnd: v.number(),
      })
    ),
    characters: v.number(),
    provider: v.string(),
    model: v.string(),
    voiceId: v.string(),
  }).index("by_sentence_hash", ["sentenceHash"]),

  /**
   * TTS usage ledger (M5), mirroring llmCalls. Unlike llmCalls, costUsd is
   * ESTIMATED from the tts pricing sheet — ElevenLabs reports no per-request
   * cost.
   */
  ttsCalls: defineTable({
    runId: v.id("runs"),
    stage: v.string(),
    unitKey: v.optional(v.string()),
    provider: v.string(),
    model: v.string(),
    voiceId: v.string(),
    characters: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
  }).index("by_run", ["runId"]),

  /**
   * Object-store bookkeeping AND (M6) the institution media catalogue.
   * Catalogue rows are `kind` "image" | "video" and carry the M6 fields
   * below; conversion/tts bookkeeping rows (page-png, page-thumb,
   * embedded-image, logo-candidate, tts-audio) keep only the original
   * columns and never surface in library queries. `rights` is
   * OPERATOR-DECLARED, defaults "unknown" at ingestion, and is never
   * written by any model (the tag-asset output schema has no rights field).
   */
  assets: defineTable({
    objectKey: v.string(),
    kind: v.string(),
    sourceProvenance: v.optional(v.string()),
    rights: v.optional(v.string()),
    // --- M6 catalogue fields (image/video rows only) ---
    institutionId: v.optional(v.id("institutions")),
    thumbKey: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    /** "portrait" | "landscape" | "square", derived from width/height. */
    aspect: v.optional(v.string()),
    /** Video only. */
    durationMs: v.optional(v.number()),
    originalName: v.optional(v.string()),
    /** "deck_extracted" | "uploaded". */
    origin: v.optional(v.string()),
    // Tagging pass output (+ its cache stamp; re-tag = version mismatch).
    caption: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    subjects: v.optional(v.array(v.string())),
    setting: v.optional(v.string()),
    textInImage: v.optional(v.string()),
    qualityScore: v.optional(v.number()),
    /** Model may raise this; only a human lowers it. */
    identifiablePeople: v.optional(v.boolean()),
    taggedAt: v.optional(v.number()),
    tagPromptVersion: v.optional(v.string()),
    tagModel: v.optional(v.string()),
    suggestedUses: v.optional(v.array(v.string())),
    // Operator declarations.
    rightsDeclaredBy: v.optional(v.string()),
    rightsDeclaredAt: v.optional(v.number()),
    peopleConsentConfirmed: v.optional(v.boolean()),
    peopleConsentBy: v.optional(v.string()),
  })
    .index("by_object_key", ["objectKey"])
    .index("by_institution", ["institutionId"])
    .index("by_institution_and_kind", ["institutionId", "kind"])
    .index("by_institution_and_object", ["institutionId", "objectKey"]),

  /**
   * One row per dispatched asset-ingest job (M6) — the admin library page
   * polls this for upload progress. jobId on the wire is the row _id.
   */
  assetIngestJobs: defineTable({
    institutionId: v.id("institutions"),
    files: v.array(
      v.object({ sourceKey: v.string(), originalName: v.string() })
    ),
    /** "dispatched" | "complete" | "failed". */
    status: v.string(),
    acceptedCount: v.optional(v.number()),
    rejected: v.optional(
      v.array(v.object({ originalName: v.string(), reason: v.string() }))
    ),
    createdBy: v.string(),
    error: v.optional(v.string()),
  }).index("by_institution", ["institutionId"]),

  /**
   * Immutable publish snapshots (M5): one row per published course version,
   * pointing at the content-addressed export.json + manifest.json in the
   * object store. Rows are never patched — a re-publish is a new version
   * (recompile bumps courses.version) and therefore a new row.
   */
  courseVersions: defineTable({
    courseId: v.id("courses"),
    institutionId: v.id("institutions"),
    runId: v.id("runs"),
    version: v.number(),
    exportKey: v.string(),
    manifestKey: v.string(),
    specHash: v.string(),
    publishedAt: v.number(),
    publishedBy: v.string(),
    counts: v.object({
      modules: v.number(),
      units: v.number(),
      questions: v.number(),
      audioArtifacts: v.number(),
    }),
  })
    .index("by_course", ["courseId"])
    .index("by_course_and_version", ["courseId", "version"])
    .index("by_run", ["runId"]),
});
