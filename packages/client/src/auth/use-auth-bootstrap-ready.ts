"use client";

import { useConvexAuth } from "convex/react";
import { useAuth } from "./createAuth";
import { useAuth as useClerkAuth } from "./clerk/use-clerk-auth";

/** True when auth bootstrap has settled enough to show the app shell. */
export function useAuthBootstrapReady(): boolean {
  const { isLoaded: clerkLoaded, isSignedIn } = useClerkAuth();
  const { isLoading: convexAuthLoading, isAuthenticated } = useConvexAuth();
  const { loading: userLoading } = useAuth();

  if (!clerkLoaded) return false;
  if (!isSignedIn) return true;

  if (convexAuthLoading || !isAuthenticated) return false;
  if (userLoading) return false;

  return true;
}
