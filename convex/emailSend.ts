"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { emailFromAddress, resend } from "./emailResend";
import {
  emailTemplateIdValidator,
  renderEmailTemplate,
  subjectForTemplate,
  type EmailTemplateId,
  type EmailTemplatePropsMap,
} from "./emailTemplates";

const sendResultValidator = v.object({
  attempted: v.number(),
  sent: v.number(),
  failed: v.number(),
});

export const sendToUser = internalAction({
  args: {
    userId: v.id("users"),
    templateId: emailTemplateIdValidator,
    props: v.any(),
  },
  returns: sendResultValidator,
  handler: async (ctx, args) => {
    const recipient = await ctx.runQuery(internal.emailQueries.getRecipient, {
      userId: args.userId,
    });

    if (!recipient) {
      return { attempted: 0, sent: 0, failed: 0 };
    }

    const templateId = args.templateId as EmailTemplateId;
    const props = args.props as EmailTemplatePropsMap[EmailTemplateId];
    const html = await renderEmailTemplate(templateId, props);
    const subject = subjectForTemplate(templateId, props);

    try {
      await resend.sendEmail(ctx, {
        from: emailFromAddress(),
        to: recipient.email,
        subject,
        html,
      });
      return { attempted: 1, sent: 1, failed: 0 };
    } catch {
      return { attempted: 1, sent: 0, failed: 1 };
    }
  },
});
