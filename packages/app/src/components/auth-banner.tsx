'use client';

import { Alert, AlertText } from '@app-template/ui';

type AuthBannerTone = 'error' | 'info';

type AuthBannerProps = {
  tone: AuthBannerTone;
  message: string;
  className?: string;
};

export function AuthBanner({ tone, message, className }: AuthBannerProps) {
  return (
    <Alert variant={tone === 'error' ? 'destructive' : 'default'} className={className ?? 'mb-4'}>
      <AlertText>{message}</AlertText>
    </Alert>
  );
}
