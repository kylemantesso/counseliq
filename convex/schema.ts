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
  v.literal("EXTRACTING"),
  v.literal("EXTRACTED"),
  v.literal("COMPILING"),
  v.literal("COMPILED"),
  v.literal("GATE_1_KNOWLEDGE_REVIEW"),
  v.literal("GENERATING_SCRIPT"),
  v.literal("GENERATING_ASSETS"),
  v.literal("QA_RUNNING"),
  v.literal("QA_PASSED"),
  v.literal("GATE_2_QUIZ_REVIEW"),
  v.literal("GATE_3_PREVIEW"),
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
  }),

  sourceDocs: defineTable({
    institutionId: v.id("institutions"),
    kind: v.string(),
    objectKey: v.string(),
    shape: v.string(),
    status: sourceDocStatusValidator,
    themeExtracted: v.optional(v.boolean()),
  }).index("by_institution", ["institutionId"]),

  slides: defineTable({
    sourceDocId: v.id("sourceDocs"),
    n: v.number(),
    pngKey: v.string(),
    text: v.any(),
    notes: v.string(),
    hash: v.string(),
  }).index("by_source_doc", ["sourceDocId"]),

  inventoryItems: defineTable({
    runId: v.id("runs"),
    kind: v.string(),
    body: v.any(),
    claimClass: v.string(),
    provenance: v.array(v.string()),
    flagged: v.boolean(),
  }).index("by_run", ["runId"]),

  runs: defineTable({
    institutionId: v.id("institutions"),
    courseId: v.optional(v.id("courses")),
    state: runStateValidator,
    promptVersions: v.any(),
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
  }).index("by_institution", ["institutionId"]),

  microUnits: defineTable({
    courseId: v.id("courses"),
    moduleKey: v.string(),
    unitKey: v.string(),
    concept: v.string(),
    narration: v.any(),
    cards: v.any(),
    contentHash: v.optional(v.string()),
    audioKey: v.optional(v.string()),
    timing: v.optional(v.any()),
    qa: v.optional(v.any()),
    state: microUnitStateValidator,
  }).index("by_course", ["courseId"]),

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
  })
    .index("by_run", ["runId"])
    .index("by_run_and_gate", ["runId", "gate"])
    .index("by_gate_and_status", ["gate", "status"]),

  llmCalls: defineTable({
    runId: v.id("runs"),
    stage: v.string(),
    promptVersion: v.string(),
    model: v.string(),
    tokensIn: v.number(),
    tokensOut: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
  }).index("by_run", ["runId"]),

  assets: defineTable({
    objectKey: v.string(),
    kind: v.string(),
    sourceProvenance: v.optional(v.string()),
    rights: v.optional(v.string()),
  }),
});
