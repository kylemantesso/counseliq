export function initializePostHog(): void {}

export function isPostHogConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN);
}
