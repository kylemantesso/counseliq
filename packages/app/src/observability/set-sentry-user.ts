export type SentryUser = {
  id: string;
  email?: string;
};

/** Platform-specific Sentry user context — no-op default. */
export function setSentryUser(_user: SentryUser | null): void {}
