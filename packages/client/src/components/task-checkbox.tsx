'use client';

import { CheckIcon, Pressable } from '@counseliq/ui';

type TaskCheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  accessibilityLabel?: string;
};

export function TaskCheckbox({
  checked,
  onChange,
  accessibilityLabel,
}: TaskCheckboxProps) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      className={`h-6 w-6 items-center justify-center rounded border ${
        checked
          ? 'border-primary bg-primary'
          : 'border-border bg-card'
      }`}
    >
      {checked ? (
        <CheckIcon height={14} width={14} color="#ffffff" />
      ) : null}
    </Pressable>
  );
}
