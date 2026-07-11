"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../db/api";
import { clerkUserDisplayName } from "./clerk/clerk-display-name";
import { useUser } from "./clerk/use-clerk-user";
import {
  resolveAuthUser,
  shouldClearEstablishedSession,
} from "./resolve-auth-user";
import { SentryUserSync } from "../observability/sentry-user-sync";
import type { AuthProviderOptions, User } from "./types";

export type AuthContextValue = {
  user: User | null;
  loading: boolean;
  needsOnboarding: boolean;
  establishSession: (user: User) => void;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within the AuthProvider");
  }
  return context;
}

export interface AuthProviderProps {
  children: ReactNode;
  signOut: () => Promise<void> | void;
  onLogout?: () => void;
}

function AuthProfileSync() {
  const { isAuthenticated } = useConvexAuth();
  const { user: clerkUser, isLoaded: clerkUserLoaded } = useUser();
  const syncAuthProfile = useMutation(api.auth.syncAuthProfile);
  const ensureUser = useMutation(api.auth.ensureUser);
  const lastSyncedName = useRef<string | null>(null);
  const ensuredRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !clerkUserLoaded) return;

    const displayName = clerkUserDisplayName(clerkUser);

    if (!ensuredRef.current) {
      ensuredRef.current = true;
      void ensureUser({ clerkDisplayName: displayName ?? undefined });
    }

    if (!displayName || displayName === lastSyncedName.current) return;

    lastSyncedName.current = displayName;
    void syncAuthProfile({ clerkDisplayName: displayName });
  }, [isAuthenticated, clerkUserLoaded, clerkUser, syncAuthProfile, ensureUser]);

  useEffect(() => {
    if (!isAuthenticated) {
      ensuredRef.current = false;
    }
  }, [isAuthenticated]);

  return null;
}

export function AuthProvider({
  children,
  signOut,
  onLogout,
}: AuthProviderProps) {
  const { isLoading: convexAuthLoading, isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(
    api.auth.currentUser,
    isAuthenticated ? {} : "skip"
  );
  const [establishedUser, setEstablishedUser] = useState<User | null>(null);

  const queryResolved = currentUser !== undefined;

  useEffect(() => {
    if (shouldClearEstablishedSession(currentUser, establishedUser)) {
      setEstablishedUser(null);
    }
  }, [currentUser, establishedUser]);

  useEffect(() => {
    if (!isAuthenticated) {
      setEstablishedUser(null);
    }
  }, [isAuthenticated]);

  const establishSession = useCallback((user: User) => {
    setEstablishedUser(user);
  }, []);

  const user = isAuthenticated
    ? resolveAuthUser(currentUser, establishedUser)
    : null;

  const loading =
    convexAuthLoading ||
    (isAuthenticated && !queryResolved && establishedUser === null);

  const needsOnboarding = isAuthenticated && !loading && user === null;

  const logout = useCallback(async () => {
    setEstablishedUser(null);
    await signOut();
    onLogout?.();
  }, [signOut, onLogout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      needsOnboarding,
      establishSession,
      logout,
    }),
    [user, loading, needsOnboarding, establishSession, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      <AuthProfileSync />
      <SentryUserSync />
      {children}
    </AuthContext.Provider>
  );
}

export type { AuthProviderOptions };
