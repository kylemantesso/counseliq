export { LoginScreen } from "./src/screens/login-screen";
export { SignupScreen } from "./src/screens/signup-screen";
export { ClientHomeScreen } from "./src/screens/client-home-screen";
export { CourseCatalogScreen } from "./src/screens/course-catalog-screen";
export { CoursePlayerScreen } from "./src/screens/course-player-screen";
export { ForceUpgradeScreen } from "./src/screens/force-upgrade-screen";

export { CoursePlayer } from "./src/components/course-player/course-player";
export type {
  RunPreviewData,
  PreviewModule,
  PreviewUnit,
  PreviewCard,
  PreviewAnchor,
  PreviewQuestion,
  PreviewNarrationSentence,
  PreviewUnitState,
  UnitPhase,
} from "./src/components/course-player/types";

export { AppErrorBoundary } from "./src/components/app-error-boundary";
export { AuthGuard } from "./src/components/auth-guard";
export { ForceUpgradeGate } from "./src/components/force-upgrade-gate";
export { OtaUpdateRuntime } from "./src/components/ota-update-runtime";
export { PostHogRuntime } from "./src/analytics/posthog-runtime";
export { PushNotificationsRuntime } from "./src/notifications/push-notifications-runtime";

export { AuthProvider, useAuth } from "./src/auth";
export { useAuthBootstrapReady } from "./src/auth/use-auth-bootstrap-ready";
export { getClerkAllowedRedirectOrigins } from "./src/auth/clerk/clerk-redirect-origins";
export type {
  User,
  AuthContextType,
  AuthProviderOptions,
  AuthProviderProps,
  AuthContextValue,
} from "./src/auth";

export { trackProductEvent } from "./src/analytics/track-product-event";
export { AnalyticsEvent } from "./src/analytics/events";
export type { AnalyticsEventName, AnalyticsCategory } from "./src/analytics/events";
export { useAnalytics } from "./src/analytics/use-analytics";

export {
  getUserFacingErrorMessage,
  EXPECTED_AUTH_CONVEX_LOG,
} from "./src/errors/get-user-facing-message";
export { getUserFacingErrorMessage as getAuthErrorMessage } from "./src/errors/get-user-facing-message";
export { APP_ERROR_MESSAGES } from "./src/errors/messages";
export { AppErrorCode, type AppErrorCodeType } from "../../convex/errors";
export { handleCaughtError } from "./src/observability/handle-caught-error";
export { shouldReportError } from "./src/observability/should-report-error";

export { createConvexClient } from "./src/db";
export { api, internal } from "./src/db/api";

export { usePushNotifications } from "./src/notifications/use-push-notifications";
