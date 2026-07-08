export type AdminToolKey =
  | "notification-log"
  | "notifications-test"
  | "email-test"
  | "sentry-test"
  | "posthog-test"
  | "source-docs"
  | "asset-library"
  | "generate-course";

export type AdminTool = {
  key: AdminToolKey;
  label: string;
  description: string;
  href: string;
};

export const ADMIN_TOOLS: readonly AdminTool[] = [
  {
    key: "notification-log",
    label: "Notification log",
    description: "Inspect recent push and email delivery attempts.",
    href: "/admin/notification-deliveries",
  },
  {
    key: "notifications-test",
    label: "Test push",
    description: "Queue test push notifications through the outbox.",
    href: "/admin/notifications-test",
  },
  {
    key: "email-test",
    label: "Test email",
    description: "Preview and queue sample transactional emails.",
    href: "/admin/email-test",
  },
  {
    key: "sentry-test",
    label: "Test Sentry",
    description: "Send test errors to verify Sentry reporting.",
    href: "/admin/sentry-test",
  },
  {
    key: "posthog-test",
    label: "Test PostHog",
    description: "Send test events to verify PostHog analytics.",
    href: "/admin/posthog-test",
  },
  {
    key: "generate-course",
    label: "Generate course",
    description: "Compile a course from an institution's facts and cleared assets.",
    href: "/admin/generate",
  },
  {
    key: "asset-library",
    label: "Asset library",
    description: "Upload media, review tags, and declare usage rights.",
    href: "/admin/assets",
  },
  {
    key: "source-docs",
    label: "Source documents",
    description: "Inspect ingested documents: pages, text, and theme.",
    href: "/admin/source-docs",
  },
] as const;
