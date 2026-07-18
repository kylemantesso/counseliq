import { z } from "zod";
import { contentAddressedKeySchema } from "./ingestion";

/** Shared request/response contract between Convex and services/renderer. */

export const renderProfileSchema = z
  .object({
    container: z.literal("mp4"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    videoCodec: z.string().min(1),
    audioCodec: z.string().min(1),
  })
  .strict();

export const renderVariantProfileSchema = renderProfileSchema
  .extend({ label: z.string().min(1) })
  .strict();

export const renderOutputVariantSchema = z
  .object({
    label: z.string().min(1),
    objectKey: contentAddressedKeySchema,
    sha256: z.string().min(1),
    sizeBytes: z.number().int().positive(),
    durationMs: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
  })
  .strict();

/**
 * Optional presenter footage for a unit render. Published manifests may carry
 * this at `units[].avatarTrack`; a dispatch can supply the same value until a
 * manifest contains it. The frozen manifest always takes precedence.
 */
export const renderAvatarTrackSchema = z
  .object({
    objectKey: contentAddressedKeySchema,
    thumbKey: contentAddressedKeySchema.optional(),
    durationMs: z.number().int().positive().optional(),
  })
  .strict();

export const renderJobRequestSchema = z
  .object({
    jobId: z.string().min(1),
    runId: z.string().min(1),
    courseVersionId: z.string().min(1),
    manifestKey: contentAddressedKeySchema,
    exportKey: contentAddressedKeySchema,
    specHash: z.string().min(1),
    unitId: z.string().min(1),
    moduleId: z.string().min(1),
    unitIndex: z.number().int().nonnegative(),
    contentHash: z.string().min(1),
    renderSpecHash: z.string().min(1),
    profile: renderProfileSchema,
    variants: z.array(renderVariantProfileSchema).min(1).optional(),
    avatarTrack: renderAvatarTrackSchema.optional(),
    callbackUrl: z.string().url(),
  })
  .strict();

export const renderSuccessPayloadSchema = z
  .object({
    objectKey: contentAddressedKeySchema,
    sha256: z.string().min(1),
    sizeBytes: z.number().int().positive(),
    durationMs: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    rendererVersion: z.string().min(1),
    renderedAt: z.number().int().positive(),
    variants: z.array(renderOutputVariantSchema).min(1).optional(),
  })
  .strict();

export const renderFailurePayloadSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();

export const renderCallbackSchema = z
  .object({
    jobId: z.string().min(1),
    status: z.union([z.literal("succeeded"), z.literal("failed")]),
    output: renderSuccessPayloadSchema.optional(),
    error: renderFailurePayloadSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "succeeded" && value.output === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["output"],
        message: "output is required when status is succeeded",
      });
    }
    if (value.status === "failed" && value.error === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["error"],
        message: "error is required when status is failed",
      });
    }
  });

export type RenderProfile = z.infer<typeof renderProfileSchema>;
export type RenderVariantProfile = z.infer<typeof renderVariantProfileSchema>;
export type RenderOutputVariant = z.infer<typeof renderOutputVariantSchema>;
export type RenderAvatarTrack = z.infer<typeof renderAvatarTrackSchema>;
export type RenderJobRequest = z.infer<typeof renderJobRequestSchema>;
export type RenderSuccessPayload = z.infer<typeof renderSuccessPayloadSchema>;
export type RenderFailurePayload = z.infer<typeof renderFailurePayloadSchema>;
export type RenderCallback = z.infer<typeof renderCallbackSchema>;
