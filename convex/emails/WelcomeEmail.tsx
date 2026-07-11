import { EmailButton, EmailLayout, EmailParagraph } from "./EmailLayout";
import type { WelcomeEmailProps } from "../emailTemplateMeta";

export function WelcomeEmail({ recipientName, dashboardUrl }: WelcomeEmailProps) {
  return (
    <EmailLayout preview="Welcome to App Template" heading={`Welcome, ${recipientName}`}>
      <EmailParagraph>
        Thanks for signing up. Your account is ready — open the admin workspace
        to start building courses.
      </EmailParagraph>
      <EmailButton href={dashboardUrl} label="Open admin workspace" />
    </EmailLayout>
  );
}
