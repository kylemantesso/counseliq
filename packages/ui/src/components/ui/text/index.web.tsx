import React from 'react';
import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';
import { textStyle } from './styles';
import { flattenWebStyle } from '../../../utils/flatten-web-style';

type ITextProps = React.ComponentProps<'span'> &
  VariantProps<typeof textStyle> & {
    style?: React.ComponentProps<'span'>['style'] | Record<string, unknown> | Array<unknown>;
    numberOfLines?: number;
  };

const Text = React.forwardRef<React.ComponentRef<'span'>, ITextProps>(
  function Text(
    {
      className,
      style,
      isTruncated,
      bold,
      underline,
      strikeThrough,
      size = 'md',
      sub,
      italic,
      highlight,
      numberOfLines,
      ...props
    }: { className?: string } & ITextProps,
    ref
  ) {
    const lineClamp =
      typeof numberOfLines === 'number' && Number.isFinite(numberOfLines) && numberOfLines > 0
        ? Math.floor(numberOfLines)
        : undefined;

    const lineClampStyle: React.CSSProperties =
      lineClamp == null
        ? {}
        : lineClamp === 1
          ? {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }
          : {
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: lineClamp,
              whiteSpace: 'normal',
            };

    return (
      <span
        className={textStyle({
          isTruncated: isTruncated as boolean,
          bold: bold as boolean,
          underline: underline as boolean,
          strikeThrough: strikeThrough as boolean,
          size,
          sub: sub as boolean,
          italic: italic as boolean,
          highlight: highlight as boolean,
          class: className,
        })}
        style={{
          ...flattenWebStyle(style as Parameters<typeof flattenWebStyle>[0]),
          ...lineClampStyle,
        }}
        {...props}
        ref={ref}
      />
    );
  }
);

Text.displayName = 'Text';

export { Text };
