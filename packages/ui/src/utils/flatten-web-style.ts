import type { CSSProperties } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';

type WebStyleInput = ViewStyle | ViewStyle[] | CSSProperties | undefined | null;

function expandRnShorthands(style: Record<string, unknown>): CSSProperties {
  const result: Record<string, unknown> = { ...style };

  if (result.paddingHorizontal != null) {
    result.paddingLeft = result.paddingHorizontal;
    result.paddingRight = result.paddingHorizontal;
    delete result.paddingHorizontal;
  }

  if (result.paddingVertical != null) {
    result.paddingTop = result.paddingVertical;
    result.paddingBottom = result.paddingVertical;
    delete result.paddingVertical;
  }

  if (result.marginHorizontal != null) {
    result.marginLeft = result.marginHorizontal;
    result.marginRight = result.marginHorizontal;
    delete result.marginHorizontal;
  }

  if (result.marginVertical != null) {
    result.marginTop = result.marginVertical;
    result.marginBottom = result.marginVertical;
    delete result.marginVertical;
  }

  if (result.flexDirection != null && result.display == null) {
    result.display = 'flex';
  }

  if (result.flex != null && result.display == null) {
    result.display = 'flex';
  }

  return result as CSSProperties;
}

/** Flatten React Native style arrays/objects for DOM elements on web. */
export function flattenWebStyle(style: WebStyleInput): CSSProperties {
  if (style == null) return {};

  const flat = Array.isArray(style)
    ? ((StyleSheet.flatten(style) ?? {}) as Record<string, unknown>)
    : ({ ...style } as Record<string, unknown>);

  return expandRnShorthands(flat);
}
