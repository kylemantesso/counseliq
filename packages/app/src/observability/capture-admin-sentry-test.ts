export type AdminSentryTestResult = {
  ok: boolean;
  detail: string;
};

export function isAdminSentryConfigured(): boolean {
  return false;
}

export function captureAdminSentryTestException(): AdminSentryTestResult {
  return { ok: false, detail: "Sentry is not configured on this platform." };
}

export function captureAdminSentryTestMessage(): AdminSentryTestResult {
  return { ok: false, detail: "Sentry is not configured on this platform." };
}
