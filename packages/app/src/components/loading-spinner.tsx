'use client';

import { Box, Spinner } from '@counseliq/ui';

type LoadingViewProps = {
  containerClassName?: string;
};

export function LoadingView({ containerClassName }: LoadingViewProps) {
  return (
    <Box className={`flex-1 items-center justify-center ${containerClassName ?? ''}`}>
      <Spinner size="large" />
    </Box>
  );
}

export function LoadingSpinner() {
  return <Spinner size="large" />;
}
