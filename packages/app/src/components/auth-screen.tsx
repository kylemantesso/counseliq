'use client';

import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { Box, KeyboardAvoidingView, ScrollView } from '@app-template/ui';
import { Screen } from './screen';

type AuthScreenProps = {
  children: ReactNode;
};

export function AuthScreen({ children }: AuthScreenProps) {
  const form = (
    <Box className="mx-auto flex w-full max-w-[420px] flex-col gap-6 px-6 py-10 md:min-h-[calc(100dvh-6rem)] md:justify-center">
      {children}
    </Box>
  );

  return (
    <Screen className="flex-1 bg-background" padding={{ top: 12, bottom: 24 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 w-full"
        style={{ flex: 1, width: '100%' }}
      >
        <ScrollView
          className="flex-1 w-full"
          {...(Platform.OS === 'web'
            ? {}
            : {
                keyboardShouldPersistTaps: 'handled' as const,
                showsVerticalScrollIndicator: false,
              })}
        >
          {form}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
