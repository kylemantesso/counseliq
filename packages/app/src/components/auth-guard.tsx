'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'solito/navigation';
import { Box, Spinner } from '@counseliq/ui';
import { useAuth } from '../auth';

type AuthGuardProps = {
  children: ReactNode;
};

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading, needsOnboarding } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !needsOnboarding && !user) {
      router.replace('/login');
    }
  }, [user, loading, needsOnboarding, router]);

  if (loading || needsOnboarding) {
    return (
      <Box className="flex-1 flex-col items-center justify-center bg-background">
        <Spinner size="large" />
      </Box>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
