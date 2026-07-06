import type { ComponentType } from 'react';
import { styled } from 'nativewind';

type CssInteropClassNameConfig = {
  target?: string | boolean;
  nativeStyleToProp?: Record<string, boolean | string>;
};

type CssInteropConfig = Record<
  string,
  CssInteropClassNameConfig | string | undefined
>;

function normalizeMapping(config: CssInteropConfig): Record<string, string> {
  const mapping: Record<string, string> = {};

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) {
      continue;
    }

    if (typeof value === 'string') {
      mapping[key] = value;
      continue;
    }

    const target = value.target;
    mapping[key] =
      typeof target === 'string' ? target : target === false ? key : 'style';
  }

  return mapping;
}

export function cssInterop<P>(
  component: ComponentType<P>,
  config: CssInteropConfig
): ComponentType<P> {
  return styled(component, normalizeMapping(config) as never) as ComponentType<P>;
}

export * from 'nativewind';
