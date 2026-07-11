import * as Sentry from "@sentry/react-native";
import type { SentryUser } from "./set-sentry-user";

export function setSentryUser(user: SentryUser | null): void {
  if (user) {
    Sentry.setUser({ id: user.id, email: user.email });
    return;
  }
  Sentry.setUser(null);
}
