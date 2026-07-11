"use client";

import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { useAuthBootstrapReady } from "../use-auth-bootstrap-ready";

/** Send users with a restored Clerk session to the app home screen. */
export function useRedirectIfSignedIn(redirectTo = "/admin") {
  const { isLoaded, isSignedIn } = useAuth();
  const bootstrapReady = useAuthBootstrapReady();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !bootstrapReady) return;

    router.replace(redirectTo as never);
  }, [bootstrapReady, isLoaded, isSignedIn, redirectTo, router]);

  return {
    isLoaded,
    isSignedIn,
    waiting: !isLoaded || (isSignedIn && !bootstrapReady),
  };
}
