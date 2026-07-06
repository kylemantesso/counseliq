'use client';

import type { ReactNode } from 'react';
import { Platform, View } from './rn-primitives';
import { GluestackUIProvider as NativeGluestackUIProvider } from './components/ui/gluestack-ui-provider';
import { GluestackUIProvider as WebGluestackUIProvider } from './components/ui/gluestack-ui-provider/index.next15';

export function UIProvider({ children }: { children: ReactNode }) {
  const GluestackUIProvider =
    Platform.OS === 'web' ? WebGluestackUIProvider : NativeGluestackUIProvider;

  return (
    <GluestackUIProvider mode="light">
      <View className="min-h-full w-full flex-1 flex-col" style={{ flex: 1, width: '100%' }}>
        {children}
      </View>
    </GluestackUIProvider>
  );
}
