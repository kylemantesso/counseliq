"use client";

import { useEffect } from "react";
import { useRouter } from "solito/navigation";
import { useAuth } from "@clerk/nextjs";
import { useAuthBootstrapReady } from "../use-auth-bootstrap-ready";

/** Send users with a restored Clerk session to the app home screen. */
export function useRedirectIfSignedIn(redirectTo = "/admin") {
  const { isLoaded, isSignedIn } = useAuth();
  const bootstrapReady = useAuthBootstrapReady();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !bootstrapReady) return;

    if (redirectTo.startsWith("http://") || redirectTo.startsWith("https://")) {
      window.location.replace(redirectTo);
      return;
    }

    router.replace(redirectTo);
  }, [bootstrapReady, isLoaded, isSignedIn, redirectTo, router]);

  return {
    isLoaded,
    isSignedIn,
    waiting: !isLoaded || (isSignedIn && !bootstrapReady),
  };
}
