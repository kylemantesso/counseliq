'use client';

import React from 'react';
import { flattenWebStyle } from '../../../utils/flatten-web-style';

type RNStyle =
  | React.ComponentProps<'div'>['style']
  | Record<string, unknown>
  | Array<React.ComponentProps<'div'>['style'] | Record<string, unknown>>;

type ScrollViewProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'style' | 'children'
> & {
  className?: string;
  style?: RNStyle | RNStyle[];
  contentContainerClassName?: string;
  contentContainerStyle?: RNStyle | RNStyle[];
  horizontal?: boolean;
  pagingEnabled?: boolean;
  showsHorizontalScrollIndicator?: boolean;
  showsVerticalScrollIndicator?: boolean;
  keyboardShouldPersistTaps?: boolean | 'always' | 'never' | 'handled';
  scrollEnabled?: boolean;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
  onMomentumScrollEnd?: React.UIEventHandler<HTMLDivElement>;
  refreshControl?: React.ReactNode;
  children?: React.ReactNode;
};

const ScrollView = React.forwardRef<HTMLDivElement, ScrollViewProps>(
  function ScrollView(
    {
      className,
      style,
      contentContainerClassName,
      contentContainerStyle,
      horizontal = false,
      pagingEnabled = false,
      showsHorizontalScrollIndicator,
      showsVerticalScrollIndicator,
      keyboardShouldPersistTaps: _keyboardShouldPersistTaps,
      scrollEnabled = true,
      onScroll,
      onMomentumScrollEnd,
      refreshControl: _refreshControl,
      children,
    },
    ref,
  ) {
    const outerStyle: React.CSSProperties = {
      ...flattenWebStyle(style as Parameters<typeof flattenWebStyle>[0]),
      overflowX: horizontal ? 'auto' : undefined,
      overflowY: horizontal ? undefined : 'auto',
      ...(scrollEnabled === false ? { overflow: 'hidden' } : {}),
      ...(horizontal ? { display: 'flex', flexDirection: 'row' } : {}),
      ...(pagingEnabled && horizontal
        ? { scrollSnapType: 'x mandatory' as const }
        : {}),
      ...(showsHorizontalScrollIndicator === false && horizontal
        ? { scrollbarWidth: 'none' as const }
        : {}),
      ...(showsVerticalScrollIndicator === false && !horizontal
        ? { scrollbarWidth: 'none' as const }
        : {}),
    };

    const innerStyle = flattenWebStyle(
      contentContainerStyle as Parameters<typeof flattenWebStyle>[0],
    );

    const handleScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
      onScroll?.(event);
    };

    const handleScrollEnd: React.UIEventHandler<HTMLDivElement> = (event) => {
      onMomentumScrollEnd?.(event);
    };

    const hasInnerWrapper =
      contentContainerClassName != null || contentContainerStyle != null;

    if (hasInnerWrapper) {
      return (
        <div
          ref={ref}
          className={className}
          style={outerStyle}
          onScroll={handleScroll}
          onScrollEnd={handleScrollEnd}
        >
          <div className={contentContainerClassName} style={innerStyle}>
            {children}
          </div>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={className}
        style={outerStyle}
        onScroll={handleScroll}
        onScrollEnd={handleScrollEnd}
      >
        {children}
      </div>
    );
  },
);

ScrollView.displayName = 'ScrollView';

export { ScrollView };
