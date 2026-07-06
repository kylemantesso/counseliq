import { EmailButton, EmailLayout, EmailParagraph } from "./EmailLayout";
import type { WelcomeEmailProps } from "../emailTemplateMeta";

export function WelcomeEmail({ recipientName, dashboardUrl }: WelcomeEmailProps) {
  return (
    <EmailLayout preview="Welcome to App Template" heading={`Welcome, ${recipientName}`}>
      <EmailParagraph>
        Thanks for signing up. Your account is ready — open the dashboard to explore
        tasks, admin tools, and more.
      </EmailParagraph>
      <EmailButton href={dashboardUrl} label="Go to dashboard" />
    </EmailLayout>
  );
}
