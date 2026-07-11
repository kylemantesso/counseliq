'use client';

import { ClerkProvider, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { UIProvider } from '@counseliq/ui';
import {
  AppErrorBoundary,
  AuthProvider,
  PostHogRuntime,
} from '@counseliq/client';
import { getClerkAllowedRedirectOrigins } from '@counseliq/client/auth';
import { ReactNode, useCallback } from 'react';
import { ConvexClientProvider } from './convex-client-provider';

function AuthProviderBridge({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { signOut } = useClerk();

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, [signOut]);

  return (
    <AuthProvider
      signOut={handleSignOut}
      onLogout={() => router.push('/login')}
    >
      {children}
    </AuthProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error('Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY in your .env file');
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/login"
      signUpUrl="/signup"
      signInFallbackRedirectUrl="/home"
      signUpFallbackRedirectUrl="/home"
      allowedRedirectOrigins={getClerkAllowedRedirectOrigins()}
    >
      <UIProvider>
        <SafeAreaProvider style={{ flex: 1, minHeight: '100%', width: '100%' }}>
          <AppErrorBoundary>
            <ConvexClientProvider>
              <AuthProviderBridge>
                <PostHogRuntime>
                  <div className="flex min-h-full flex-1 flex-col">{children}</div>
                </PostHogRuntime>
              </AuthProviderBridge>
            </ConvexClientProvider>
          </AppErrorBoundary>
        </SafeAreaProvider>
      </UIProvider>
    </ClerkProvider>
  );
}
