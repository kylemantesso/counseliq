import type { AnalyticsProperties } from "./analytics-config";

export const AnalyticsEvent = {
  AUTH_SIGN_IN_COMPLETED: "auth_sign_in_completed",
  AUTH_SIGN_IN_FAILED: "auth_sign_in_failed",
  AUTH_SIGN_OUT: "auth_sign_out",
  TASK_CREATED: "task_created",
  TASK_TOGGLED: "task_toggled",
  NOTIFICATION_PUSH_ENABLED: "notification_push_enabled",
  SCREEN_VIEWED: "screen_viewed",
  ADMIN_POSTHOG_TEST: "admin_posthog_test",
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

export type AnalyticsCategory =
  | "auth"
  | "tasks"
  | "navigation"
  | "notification"
  | "admin";

export function buildAnalyticsProperties(
  category: AnalyticsCategory,
  properties?: AnalyticsProperties
): AnalyticsProperties {
  return { category, ...properties };
}
