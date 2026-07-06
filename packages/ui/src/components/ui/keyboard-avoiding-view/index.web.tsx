'use client';

import React from 'react';
import { flattenWebStyle } from '../../../utils/flatten-web-style';

type KeyboardAvoidingViewProps = React.ComponentPropsWithoutRef<'div'> & {
  behavior?: 'padding' | 'height' | 'position';
  style?: React.ComponentProps<'div'>['style'] | Record<string, unknown> | Array<unknown>;
};

const KeyboardAvoidingView = React.forwardRef<
  HTMLDivElement,
  KeyboardAvoidingViewProps
>(function KeyboardAvoidingView(
  { style, children, behavior: _behavior, className, id, role, tabIndex, 'aria-label': ariaLabel },
  ref,
) {
  return (
    <div
      ref={ref}
      className={className}
      id={id}
      role={role}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      style={flattenWebStyle(style)}
    >
      {children}
    </div>
  );
});

KeyboardAvoidingView.displayName = 'KeyboardAvoidingView';

export { KeyboardAvoidingView };
