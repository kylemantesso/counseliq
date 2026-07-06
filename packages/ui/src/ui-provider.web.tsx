'use client';

import type { ReactNode } from 'react';
import { GluestackUIProvider } from './components/ui/gluestack-ui-provider/index.next15';

export function UIProvider({ children }: { children: ReactNode }) {
  return <GluestackUIProvider mode="light">{children}</GluestackUIProvider>;
}
