'use client';

import type { ComponentProps, ReactNode } from 'react';
import {
  Box,
  Button,
  ButtonText,
  FormControl,
  FormControlError,
  FormControlErrorText,
  FormControlHelper,
  FormControlHelperText,
  FormControlLabel,
  FormControlLabelText,
  Heading,
  Input,
  InputField,
  Text,
} from '@app-template/ui';

type InputFieldProps = ComponentProps<typeof InputField>;

type AuthFieldProps = {
  label: string;
  error?: string | null;
  helper?: string;
} & InputFieldProps;

export function AuthField({ label, error, helper, ...fieldProps }: AuthFieldProps) {
  return (
    <FormControl isInvalid={Boolean(error)}>
      <FormControlLabel>
        <FormControlLabelText>{label}</FormControlLabelText>
      </FormControlLabel>
      <Input>
        <InputField {...fieldProps} />
      </Input>
      {helper && !error ? (
        <FormControlHelper>
          <FormControlHelperText>{helper}</FormControlHelperText>
        </FormControlHelper>
      ) : null}
      {error ? (
        <FormControlError>
          <FormControlErrorText>{error}</FormControlErrorText>
        </FormControlError>
      ) : null}
    </FormControl>
  );
}

type AuthPrimaryButtonProps = {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
};

export function AuthPrimaryButton({
  children,
  onPress,
  disabled,
}: AuthPrimaryButtonProps) {
  return (
    <Button
      variant="default"
      size="lg"
      isDisabled={disabled}
      onPress={onPress}
      className="w-full"
    >
      <ButtonText>{children}</ButtonText>
    </Button>
  );
}

export function AuthDivider({ label = 'Or continue with' }: { label?: string }) {
  return (
    <Box className="mt-2 flex-row items-center gap-3">
      <Box className="h-px flex-1 bg-border" />
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Box className="h-px flex-1 bg-border" />
    </Box>
  );
}

export function AuthStepHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
}) {
  return (
    <Box className="gap-2">
      {eyebrow ? (
        <Text className="text-sm font-medium text-primary">{eyebrow}</Text>
      ) : null}
      <Heading size="2xl">{title}</Heading>
      {description ? (
        <Text className="text-muted-foreground">{description}</Text>
      ) : null}
    </Box>
  );
}

export function AuthLinkText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Text className={`text-sm font-semibold text-primary ${className ?? ''}`}>
      {children}
    </Text>
  );
}

export function AuthMutedText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Text className={`text-sm text-muted-foreground ${className ?? ''}`}>
      {children}
    </Text>
  );
}
