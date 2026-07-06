import type { EmailTemplateId, EmailTemplatePropsMap } from "./emailTemplateMeta";

function emailShell(heading: string, bodyHtml: string): string {
  const dashboardUrl = `${process.env.APP_WEB_ORIGIN ?? "http://localhost:3000"}/dashboard`;
  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:32px 16px;background:#F5F5F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:32px 28px;">
      <div style="color:#6366F1;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 20px;">App Template</div>
      <h1 style="color:#1A1A1A;font-size:28px;font-weight:700;line-height:1.2;margin:0 0 20px;">${heading}</h1>
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:28px 0 20px;" />
      <p style="color:#6B7280;font-size:12px;line-height:1.5;margin:0;">App Template — cross-platform starter with Convex.</p>
      <p style="color:#6B7280;font-size:12px;line-height:1.5;margin:12px 0 0;"><a href="${dashboardUrl}" style="color:#6366F1;">Open dashboard</a></p>
    </div>
  </body>
</html>`;
}

function paragraph(text: string): string {
  return `<p style="color:#6B7280;font-size:15px;line-height:1.6;margin:0 0 16px;">${text}</p>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:28px 0 8px;"><a href="${href}" style="background:#6366F1;color:#FFFFFF;display:inline-block;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px;text-decoration:none;">${label}</a></p>`;
}

export function buildSamplePreviewHtml<T extends EmailTemplateId>(
  templateId: T,
  props: EmailTemplatePropsMap[T]
): string {
  switch (templateId) {
    case "welcome": {
      const p = props as EmailTemplatePropsMap["welcome"];
      return emailShell(
        `Welcome, ${p.recipientName}`,
        `${paragraph("Thanks for signing up. Your account is ready.")}${button(p.dashboardUrl, "Go to dashboard")}`
      );
    }
  }
}
