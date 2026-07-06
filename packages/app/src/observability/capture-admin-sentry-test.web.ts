import * as Sentry from "@sentry/nextjs";
import type { AdminSentryTestResult } from "./capture-admin-sentry-test";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export function isAdminSentryConfigured(): boolean {
  return Boolean(dsn);
}

export function captureAdminSentryTestException(): AdminSentryTestResult {
  if (!dsn) {
    return { ok: false, detail: "NEXT_PUBLIC_SENTRY_DSN is not set." };
  }

  const error = new Error("ROVR admin Sentry test exception");
  Sentry.captureException(error, {
    tags: { source: "admin-sentry-test" },
    level: "error",
  });

  return { ok: true, detail: "Exception sent to Sentry." };
}

export function captureAdminSentryTestMessage(): AdminSentryTestResult {
  if (!dsn) {
    return { ok: false, detail: "NEXT_PUBLIC_SENTRY_DSN is not set." };
  }

  Sentry.captureMessage("ROVR admin Sentry test message", {
    tags: { source: "admin-sentry-test" },
    level: "info",
  });

  return { ok: true, detail: "Message sent to Sentry." };
}
