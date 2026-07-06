import { v } from "convex/values";
import { appWebOrigin } from "./emailResend";

export const EMAIL_TEMPLATE_IDS = ["welcome"] as const;

export type EmailTemplateId = (typeof EMAIL_TEMPLATE_IDS)[number];

export const emailTemplateIdValidator = v.union(v.literal("welcome"));

export type WelcomeEmailProps = {
  recipientName: string;
  dashboardUrl: string;
};

export type EmailTemplatePropsMap = {
  welcome: WelcomeEmailProps;
};

export type EmailTemplateMeta = {
  id: EmailTemplateId;
  name: string;
  description: string;
  sampleProps: EmailTemplatePropsMap[EmailTemplateId];
};

const origin = appWebOrigin();

export const EMAIL_TEMPLATE_META: EmailTemplateMeta[] = [
  {
    id: "welcome",
    name: "Welcome",
    description: "Sent when a new user joins the app.",
    sampleProps: {
      recipientName: "Alex",
      dashboardUrl: `${origin}/dashboard`,
    },
  },
];

export function subjectForTemplate(
  templateId: EmailTemplateId,
  _props: EmailTemplatePropsMap[EmailTemplateId]
): string {
  switch (templateId) {
    case "welcome":
      return "Welcome to App Template";
  }
}
