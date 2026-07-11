"use client";

import { useEffect } from "react";
import { useAuth } from "../auth";
import { setSentryUser } from "./set-sentry-user";

/** Attach the signed-in user to Sentry error reports. */
export function SentryUserSync() {
  const { user } = useAuth();

  useEffect(() => {
    setSentryUser(
      user
        ? {
            id: user.userId,
            email: user.email,
          }
        : null
    );
  }, [user?.userId, user?.email]);

  return null;
}
