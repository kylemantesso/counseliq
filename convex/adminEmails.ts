import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getUserForIdentity } from "./auth";
import { requireAdmin } from "./admin";
import { isAdminUser } from "./adminAccess";
import { AppErrorCode, appError } from "./errors";
import {
  EMAIL_TEMPLATE_META,
  emailTemplateIdValidator,
  subjectForTemplate,
  type EmailTemplateId,
  type EmailTemplatePropsMap,
} from "./emailTemplateMeta";
import { buildSamplePreviewHtml } from "./emailPreviewHtml";

const templateMetaValidator = v.object({
  id: emailTemplateIdValidator,
  name: v.string(),
  description: v.string(),
  sampleProps: v.any(),
});

const emailTestPageValidator = v.union(
  v.null(),
  v.object({
    userId: v.id("users"),
    email: v.string(),
    name: v.string(),
    templates: v.array(templateMetaValidator),
  })
);

const sendResultValidator = v.object({
  deliveryId: v.id("notificationDeliveries"),
  status: v.literal("pending"),
});

/** Public admin gate for actions — auth propagates reliably from the client caller. */
export const assertAdmin = query({
  args: {},
  returns: v.object({
    _id: v.id("users"),
    email: v.string(),
    name: v.string(),
  }),
  handler: async (ctx) => {
    const user = await requireAdmin(ctx);
    return {
      _id: user._id,
      email: user.email,
      name: user.name,
    };
  },
});

/** Admin-only context for the email test page. */
export const getEmailTestPage = query({
  args: {},
  returns: emailTestPageValidator,
  handler: async (ctx) => {
    const user = await getUserForIdentity(ctx);
    if (!user || !isAdminUser(user)) {
      return null;
    }

    return {
      userId: user._id,
      email: user.email,
      name: user.name,
      templates: EMAIL_TEMPLATE_META.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        sampleProps: template.sampleProps,
      })),
    };
  },
});

const previewResultValidator = v.union(
  v.null(),
  v.object({
    html: v.string(),
    subject: v.string(),
  })
);

/** Admin preview — static HTML from sample props (no Node/React Email round trip). */
export const getEmailTemplatePreview = query({
  args: { templateId: emailTemplateIdValidator },
  returns: previewResultValidator,
  handler: async (ctx, args) => {
    const user = await getUserForIdentity(ctx);
    if (!user || !isAdminUser(user)) {
      return null;
    }

    const meta = EMAIL_TEMPLATE_META.find((row) => row.id === args.templateId);
    if (!meta) {
      return null;
    }

    const templateId = args.templateId as EmailTemplateId;
    return {
      html: buildSamplePreviewHtml(templateId, meta.sampleProps),
      subject: subjectForTemplate(templateId, meta.sampleProps),
    };
  },
});

/** Queue a template email test via the notification outbox. */
export const sendTestEmail = mutation({
  args: {
    templateId: emailTemplateIdValidator,
    targetEmail: v.optional(v.string()),
    props: v.optional(v.any()),
  },
  returns: sendResultValidator,
  handler: async (ctx, args): Promise<{
    deliveryId: Id<"notificationDeliveries">;
    status: "pending";
  }> => {
    const admin = await requireAdmin(ctx);

    let targetUserId: Id<"users"> = admin._id;
    const targetEmail = args.targetEmail?.trim().toLowerCase();

    if (targetEmail) {
      const target = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", targetEmail))
        .first();
      if (!target) {
        appError(AppErrorCode.USER_NOT_FOUND);
      }
      targetUserId = target._id;
    }

    const meta = EMAIL_TEMPLATE_META.find((row) => row.id === args.templateId);
    if (!meta) {
      appError(AppErrorCode.EMAIL_SEND_FAILED);
    }

    const props =
      (args.props as EmailTemplatePropsMap[EmailTemplateId] | undefined) ??
      meta.sampleProps;

    const now = Date.now();
    const result = await ctx.runMutation(internal.adminOutbox.enqueueTestDelivery, {
      userId: targetUserId,
      channel: "email",
      idempotencyKey: `admin_test:email:${targetUserId}:${args.templateId}:${now}`,
      payload: {
        templateId: args.templateId,
        props,
      },
    });

    await ctx.runMutation(internal.notificationOutbox.processPendingBatch, {});
    return result;
  },
});
