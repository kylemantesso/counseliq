import React from 'react';
import { boxStyle } from './styles';
import { flattenWebStyle } from '../../../utils/flatten-web-style';

import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';

type IBoxProps = React.ComponentPropsWithoutRef<'div'> &
  VariantProps<typeof boxStyle> & {
    className?: string;
    style?: React.ComponentProps<'div'>['style'] | Record<string, unknown> | Array<unknown>;
  };

const Box = React.forwardRef<HTMLDivElement, IBoxProps>(function Box(
  { className, style, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={boxStyle({ class: className })}
      style={flattenWebStyle(style as Parameters<typeof flattenWebStyle>[0])}
      {...props}
    />
  );
});

Box.displayName = 'Box';
export { Box };
