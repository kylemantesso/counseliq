"use client";

import { Box, Pressable, Text } from "@app-template/ui";
import {
  AuthField,
  AuthLinkText,
  AuthMutedText,
  AuthPrimaryButton,
  AuthStepHeader,
} from "./auth-form";
import { AuthBanner } from "./auth-banner";

type EmailVerificationFlow = "sign-in" | "sign-up" | "forgot-password";

type EmailVerificationStepProps = {
  flow?: EmailVerificationFlow;
  email: string;
  code: string;
  onCodeChange: (code: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onChangeEmail: () => void;
  loading: boolean;
  resending: boolean;
  error: string;
  info: string;
  resendCooldownSeconds: number;
};

const COPY: Record<
  EmailVerificationFlow,
  {
    eyebrow: string;
    title: string;
    bodyPrefix: string;
    bodySuffix: string;
    verifyLabel: string;
    verifyingLabel: string;
    changeEmailLabel: string;
  }
> = {
  "sign-in": {
    eyebrow: "Almost there",
    title: "Check your email",
    bodyPrefix: "Enter the 6-digit code we sent to",
    bodySuffix: "to confirm this device.",
    verifyLabel: "Continue",
    verifyingLabel: "Verifying...",
    changeEmailLabel: "Back to sign in",
  },
  "sign-up": {
    eyebrow: "One more step",
    title: "Verify your email",
    bodyPrefix: "Enter the 6-digit code we sent to",
    bodySuffix: "to finish creating your account.",
    verifyLabel: "Verify email",
    verifyingLabel: "Verifying...",
    changeEmailLabel: "Use a different email",
  },
  "forgot-password": {
    eyebrow: "Check your email",
    title: "Enter reset code",
    bodyPrefix: "Enter the 6-digit code we sent to",
    bodySuffix: "to reset your password.",
    verifyLabel: "Verify code",
    verifyingLabel: "Verifying...",
    changeEmailLabel: "Use a different email",
  },
};

export function EmailVerificationStep({
  flow = "sign-up",
  email,
  code,
  onCodeChange,
  onVerify,
  onResend,
  onChangeEmail,
  loading,
  resending,
  error,
  info,
  resendCooldownSeconds,
}: EmailVerificationStepProps) {
  const copy = COPY[flow];
  const codeIsValid = /^\d{6}$/.test(code);
  const canVerify = codeIsValid && !loading;
  const canResend = resendCooldownSeconds === 0 && !resending && !loading;

  return (
    <Box className="flex-col gap-5">
      <AuthStepHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={
          <>
            {copy.bodyPrefix}{" "}
            <Text className="font-semibold text-foreground">{email}</Text>{" "}
            {copy.bodySuffix}
          </>
        }
      />

      {info ? <AuthBanner tone="info" message={info} /> : null}
      {error ? <AuthBanner tone="error" message={error} /> : null}

      <AuthField
        label="Verification code"
        placeholder="000000"
        value={code}
        onChangeText={(value) =>
          onCodeChange(value.replace(/\D/g, "").slice(0, 6))
        }
        keyboardType="number-pad"
        maxLength={6}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        className="text-center text-lg tracking-widest"
      />

      <AuthPrimaryButton onPress={onVerify} disabled={!canVerify || loading}>
        {loading ? copy.verifyingLabel : copy.verifyLabel}
      </AuthPrimaryButton>

      <Pressable
        onPress={onResend}
        disabled={!canResend}
        accessibilityRole="button"
        accessibilityLabel="Resend code"
        accessibilityState={{ disabled: !canResend }}
        className="mt-2 self-center"
      >
        {resending ? (
          <AuthMutedText>Sending...</AuthMutedText>
        ) : resendCooldownSeconds > 0 ? (
          <AuthMutedText>{`Resend code in ${resendCooldownSeconds}s`}</AuthMutedText>
        ) : (
          <AuthLinkText className={canResend ? undefined : 'text-muted-foreground'}>
            Resend code
          </AuthLinkText>
        )}
      </Pressable>

      <Pressable
        onPress={onChangeEmail}
        accessibilityRole="button"
        accessibilityLabel="Use a different email"
        className="self-center"
      >
        <AuthMutedText>{copy.changeEmailLabel}</AuthMutedText>
      </Pressable>
    </Box>
  );
}
