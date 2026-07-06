"use node";

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { AppErrorCode, appError } from "./errors";
import {
  EMAIL_TEMPLATE_META,
  emailTemplateIdValidator,
  type EmailTemplateId,
  type EmailTemplatePropsMap,
} from "./emailTemplateMeta";
import {
  emailTemplateIdValidator as templateIdValidator,
  renderEmailTemplate,
  subjectForTemplate,
} from "./emailTemplates";

export const previewEmailTemplate = action({
  args: {
    templateId: emailTemplateIdValidator,
    props: v.optional(v.any()),
  },
  returns: v.object({ html: v.string(), subject: v.string() }),
  handler: async (ctx, args): Promise<{ html: string; subject: string }> => {
    await ctx.runQuery(api.adminEmails.assertAdmin, {});

    const meta = EMAIL_TEMPLATE_META.find((row) => row.id === args.templateId);
    if (!meta) {
      appError(AppErrorCode.EMAIL_SEND_FAILED);
    }

    const props =
      (args.props as EmailTemplatePropsMap[EmailTemplateId] | undefined) ??
      meta.sampleProps;

    const templateId = args.templateId as EmailTemplateId;
    const html = await renderEmailTemplate(templateId, props);
    const subject = subjectForTemplate(templateId, props);
    return { html, subject };
  },
});

export const renderTemplatePreview = internalAction({
  args: {
    templateId: templateIdValidator,
    props: v.any(),
  },
  returns: v.object({ html: v.string(), subject: v.string() }),
  handler: async (_ctx, args) => {
    const templateId = args.templateId as EmailTemplateId;
    const props = args.props as EmailTemplatePropsMap[EmailTemplateId];
    const html = await renderEmailTemplate(templateId, props);
    const subject = subjectForTemplate(templateId, props);
    return { html, subject };
  },
});
