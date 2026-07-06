import * as Sentry from '@sentry/nextjs';

export function getSentryDsn(): string | undefined {
  return process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
}

export function getServerSentryOptions(
  runtime: 'nodejs' | 'edge',
): Sentry.NodeOptions {
  const isDev = process.env.NODE_ENV === 'development';
  const dsn = getSentryDsn();
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown';

  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.NODE_ENV,
    release: `app-template-web@${appVersion}`,
    sendDefaultPii: true,
    tracesSampleRate: isDev ? 1.0 : 0.1,
    enableLogs: true,
    initialScope: {
      tags: {
        surface: 'web',
        runtime,
      },
    },
  };
}
