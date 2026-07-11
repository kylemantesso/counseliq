import type { PostHog } from "posthog-react-native";

let client: PostHog | null = null;

export function bindPostHogClient(next: PostHog | null): void {
  client = next;
}

export function getPostHogClient(): PostHog | null {
  return client;
}
