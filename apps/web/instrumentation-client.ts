import { initializePostHog } from '@counseliq/app/analytics/posthog-init';
import * as Sentry from '@sentry/nextjs';

initializePostHog();

const isDev = process.env.NODE_ENV === 'development';
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NODE_ENV,
  release: `counseliq-web@${appVersion}`,
  sendDefaultPii: true,
  tracesSampleRate: isDev ? 1.0 : 0.1,
  replaysSessionSampleRate: isDev ? 1.0 : 0.1,
  replaysOnErrorSampleRate: 1.0,
  enableLogs: true,
  integrations: [Sentry.replayIntegration()],
  initialScope: {
    tags: {
      surface: 'web',
      runtime: 'browser',
    },
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
