'use client';

import { useState } from 'react';
import { Pressable, Text } from '@counseliq/ui';

type OAuthProvider = 'google' | 'apple';

type OAuthButtonProps = {
  provider: OAuthProvider;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  className?: string;
};

const PROVIDER_BRAND: Record<
  OAuthProvider,
  { bg: string; border: string; text: string }
> = {
  google: { bg: '#FFFFFF', border: '#E5E5E5', text: '#0A0A0A' },
  apple: { bg: '#000000', border: '#000000', text: '#FFFFFF' },
};

export function OAuthButton({
  provider,
  label,
  onPress,
  disabled = false,
  className,
}: OAuthButtonProps) {
  const [pressed, setPressed] = useState(false);
  const brand = PROVIDER_BRAND[provider];

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className={`mt-2.5 h-12 w-full flex-row items-center justify-center rounded-full ${className ?? ''}`}
      style={{
        backgroundColor: brand.bg,
        borderWidth: 1,
        borderColor: brand.border,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      }}
    >
      <Text className="text-sm font-semibold" style={{ color: brand.text }}>
        {label}
      </Text>
    </Pressable>
  );
}
