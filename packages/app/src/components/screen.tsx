'use client';

import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box } from '@counseliq/ui';

type SafeAreaEdge = 'top' | 'bottom' | 'left' | 'right';

type ScreenProps = {
  children: ReactNode;
  className?: string;
  style?: ViewProps['style'];
  /** Safe-area edges to pad. Default: top + bottom. */
  edges?: SafeAreaEdge[];
  /** Extra padding applied on top of safe-area insets per edge. */
  padding?: Partial<Record<SafeAreaEdge, number>>;
};

export function Screen({
  children,
  className = 'flex-1',
  style,
  edges = ['top', 'bottom'],
  padding = {},
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  const safeAreaStyle: ViewProps['style'] = {};

  if (edges.includes('top')) {
    safeAreaStyle.paddingTop = insets.top + (padding.top ?? 0);
  } else if (padding.top !== undefined) {
    safeAreaStyle.paddingTop = padding.top;
  }

  if (edges.includes('bottom')) {
    safeAreaStyle.paddingBottom = insets.bottom + (padding.bottom ?? 0);
  } else if (padding.bottom !== undefined) {
    safeAreaStyle.paddingBottom = padding.bottom;
  }

  if (edges.includes('left')) {
    safeAreaStyle.paddingLeft = insets.left + (padding.left ?? 0);
  } else if (padding.left !== undefined) {
    safeAreaStyle.paddingLeft = padding.left;
  }

  if (edges.includes('right')) {
    safeAreaStyle.paddingRight = insets.right + (padding.right ?? 0);
  } else if (padding.right !== undefined) {
    safeAreaStyle.paddingRight = padding.right;
  }

  return (
    <Box className={className} style={[{ flex: 1 }, safeAreaStyle, style]}>
      {children}
    </Box>
  );
}
