import { z } from "zod";

/** Semantic card templates with a dedicated avatar-video overlay design. */
export const AVATAR_OVERLAY_TEMPLATES = [
  "title-card",
  "stat-card",
  "list-reveal",
  "comparison-split",
  "quote-card",
  "map-card",
  "timeline-card",
  "takeaway-card",
  "pathway-card",
  "persona-card",
  "alert-card",
  "breakdown-card",
  "myth-fact-card",
  "text-card",
] as const;

export const visualTreatmentSchema = z.enum(["standard", "avatar-overlay"]);
export type VisualTreatment = z.infer<typeof visualTreatmentSchema>;

export const avatarLookSchema = z
  .object({
    groupId: z.string().min(1),
    lookId: z.string().min(1),
    name: z.string().min(1),
    previewImageUrl: z.string().url().nullable().optional(),
    preferredOrientation: z.enum(["portrait", "landscape", "square"]).nullable().optional(),
    supportedEngines: z.array(z.string()).optional(),
    avatarType: z.enum(["photo_avatar", "digital_twin", "studio_avatar"]).optional(),
  })
  .strict();

export const avatarLookEvaluationSchema = z
  .object({
    description: z.string().min(1),
    setting: z.string().min(1),
    attire: z.string().min(1),
    framing: z.string().min(1),
    tone: z.string().min(1),
    suitableTopics: z.array(z.string().min(1)).min(1),
    visualTags: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const avatarLookAssignmentSchema = z
  .object({
    look: avatarLookSchema,
    source: z.enum(["ai", "manual", "fallback"]),
    reason: z.string().min(1),
    promptVersion: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    assignedAt: z.number(),
    manuallyLocked: z.boolean().optional(),
  })
  .strict();

export const coursePresentationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("standard") }).strict(),
  z
    .object({
      mode: z.literal("avatar"),
      provider: z.literal("heygen"),
      avatarGroupId: z.string().min(1),
      defaultLook: avatarLookSchema,
      /** Filled after compilation and editable at Gate 2, keyed by unit id. */
      unitLooks: z.record(z.string().min(1), avatarLookSchema).default({}),
      /** Assignment provenance used by Gate 2 and protected manual choices. */
      unitAssignments: z
        .record(z.string().min(1), avatarLookAssignmentSchema)
        .default({}),
      /** Legacy draft-run shape retained while moving to per-video selection. */
      moduleLooks: z.record(z.string().min(1), avatarLookSchema).optional(),
      assignmentStrategy: z.union([z.literal("ai-per-unit"), z.literal("ai-per-module")]),
      engine: z.enum(["avatar_iv", "avatar_v"]).default("avatar_iv"),
    })
    .strict(),
]);

export type AvatarLook = z.infer<typeof avatarLookSchema>;
export type AvatarLookEvaluation = z.infer<typeof avatarLookEvaluationSchema>;
export type AvatarLookAssignment = z.infer<typeof avatarLookAssignmentSchema>;
export type CoursePresentation = z.infer<typeof coursePresentationSchema>;

export function supportsAvatarOverlay(template: string): boolean {
  return (AVATAR_OVERLAY_TEMPLATES as readonly string[]).includes(template);
}
