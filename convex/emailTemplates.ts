"use node";

import { render } from "@react-email/render";
import { WelcomeEmail } from "./emails/WelcomeEmail";
import {
  type EmailTemplateId,
  type EmailTemplatePropsMap,
  emailTemplateIdValidator,
  subjectForTemplate,
} from "./emailTemplateMeta";

export { emailTemplateIdValidator, subjectForTemplate };
export type { EmailTemplateId, EmailTemplatePropsMap };

export async function renderEmailTemplate<T extends EmailTemplateId>(
  templateId: T,
  props: EmailTemplatePropsMap[T]
): Promise<string> {
  switch (templateId) {
    case "welcome":
      return render(WelcomeEmail(props as EmailTemplatePropsMap["welcome"]));
  }
}
