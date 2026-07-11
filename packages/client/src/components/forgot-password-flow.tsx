"use client";

import { useEffect, useState } from "react";
import { Box, Pressable } from "@counseliq/ui";
import { useRouter } from "solito/navigation";
import {
  AuthField,
  AuthMutedText,
  AuthPrimaryButton,
  AuthStepHeader,
} from "./auth-form";
import { clerkErrorMessage } from "../auth/clerk/clerk-errors";
import { isSessionExistsError } from "../auth/clerk/is-session-exists-error";
import {
  activateSignInSession,
  createSignInWithIdentifier,
  isSignInComplete,
  sendResetPasswordEmailCode,
  signInNeedsEmailVerification,
  sendSignInEmailMfaCode,
  signInNeedsNewPassword,
  submitResetPassword,
  useClerkSignInFlow,
  verifyResetPasswordEmailCode,
  verifySignInEmailMfaCode,
  type ClerkSignInResource,
} from "../auth/clerk/use-clerk-sign-in-flow";
import { useAuth as useClerkAuth } from "../auth/clerk/use-clerk-auth";
import { EMAIL_REGEX } from "../constants";
import { AuthBanner } from "./auth-banner";
import { EmailVerificationStep } from "./email-verification-step";

const RESEND_COOLDOWN_SECONDS = 60;

type ForgotPasswordStep = "email" | "verify" | "new-password" | "mfa";

type ForgotPasswordFlowProps = {
  initialEmail?: string;
  onBack: () => void;
};

export function ForgotPasswordFlow({
  initialEmail = "",
  onBack,
}: ForgotPasswordFlowProps) {
  const { signIn, signInReady, setActive } = useClerkSignInFlow();
  const { isSignedIn } = useClerkAuth();
  const router = useRouter();

  const [step, setStep] = useState<ForgotPasswordStep>("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [touched, setTouched] = useState({ email: false, password: false });

  const emailIsValid = EMAIL_REGEX.test(email.trim());
  const passwordIsValid = password.length >= 8;
  const canSendCode = emailIsValid && !loading && signInReady;
  const canSetPassword = passwordIsValid && !loading && signInReady;

  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setResendCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldownSeconds]);

  const finishSignIn = async (
    result: NonNullable<typeof signIn>,
  ): Promise<void> => {
    await activateSignInSession(result, setActive);
    router.replace("/home");
  };

  const handleMfaIfNeeded = async (
    result: ClerkSignInResource,
  ): Promise<boolean> => {
    if (!signInNeedsEmailVerification(result)) {
      return false;
    }

    await sendSignInEmailMfaCode(result, email.trim());
    setCode("");
    setStep("mfa");
    setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    return true;
  };

  const handleSendCode = async () => {
    setError("");
    setInfo("");
    setTouched({ email: true, password: false });

    if (!emailIsValid) {
      setError("Enter a valid email address.");
      return;
    }
    if (!signInReady || !signIn) return;

    if (isSignedIn) {
      router.replace("/home");
      return;
    }

    setLoading(true);
    try {
      await createSignInWithIdentifier(signIn, email.trim());
      await sendResetPasswordEmailCode(signIn);
      setCode("");
      setStep("verify");
      setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    } catch (err: unknown) {
      if (isSessionExistsError(err)) {
        router.replace("/home");
        return;
      }
      setError(
        clerkErrorMessage(
          err,
          "Could not send a reset code. Check your email and try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setError("");
    setInfo("");
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    if (!signIn) {
      setError("Reset session expired. Go back and try again.");
      return;
    }

    setLoading(true);
    try {
      const result = await verifyResetPasswordEmailCode(signIn, code);
      if (signInNeedsNewPassword(result)) {
        setPassword("");
        setTouched({ email: false, password: false });
        setStep("new-password");
        return;
      }

      setError("Verification did not complete. Try again.");
    } catch (err: unknown) {
      setError(
        clerkErrorMessage(err, "Invalid or expired code. Try again or resend."),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!signIn || resendCooldownSeconds > 0) return;
    setError("");
    setInfo("");
    setResending(true);
    try {
      await sendResetPasswordEmailCode(signIn);
      setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
      setInfo("We sent a new reset code.");
    } catch (err: unknown) {
      setError(clerkErrorMessage(err, "Could not resend the code. Try again."));
    } finally {
      setResending(false);
    }
  };

  const handleSetPassword = async () => {
    setError("");
    setInfo("");
    setTouched({ email: false, password: true });

    if (!passwordIsValid) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!signIn) {
      setError("Reset session expired. Go back and try again.");
      return;
    }

    setLoading(true);
    try {
      const result = await submitResetPassword(signIn, password);

      if (await handleMfaIfNeeded(result)) {
        return;
      }

      if (!isSignInComplete(result)) {
        setError("Password reset could not be completed. Try again.");
        return;
      }

      await finishSignIn(result);
    } catch (err: unknown) {
      if (isSessionExistsError(err)) {
          router.replace("/home");
        return;
      }
      setError(
        clerkErrorMessage(err, "Could not set your new password. Try again."),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async () => {
    setError("");
    setInfo("");
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    if (!signIn) {
      setError("Reset session expired. Go back and try again.");
      return;
    }

    setLoading(true);
    try {
      const result = await verifySignInEmailMfaCode(signIn, code);
      if (!isSignInComplete(result)) {
        setError("Verification did not complete sign-in. Try again.");
        return;
      }
      await finishSignIn(result);
    } catch (err: unknown) {
      if (isSessionExistsError(err)) {
          router.replace("/home");
        return;
      }
      setError(clerkErrorMessage(err, "Invalid or expired code. Try again or resend."));
    } finally {
      setLoading(false);
    }
  };

  const handleResendMfa = async () => {
    if (!signIn || resendCooldownSeconds > 0) return;
    setError("");
    setInfo("");
    setResending(true);
    try {
      await sendSignInEmailMfaCode(signIn, email.trim());
      setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
      setInfo("We sent a new verification code.");
    } catch (err: unknown) {
      setError(clerkErrorMessage(err, "Could not resend the code. Try again."));
    } finally {
      setResending(false);
    }
  };

  if (step === "verify" || step === "mfa") {
    return (
      <EmailVerificationStep
        flow={step === "mfa" ? "sign-in" : "forgot-password"}
        email={email.trim()}
        code={code}
        onCodeChange={setCode}
        onVerify={() => void (step === "mfa" ? handleVerifyMfa() : handleVerifyCode())}
        onResend={() =>
          void (step === "mfa" ? handleResendMfa() : handleResendCode())
        }
        onChangeEmail={() => {
          setStep("email");
          setCode("");
          setError("");
          setInfo("");
        }}
        loading={loading}
        resending={resending}
        error={error}
        info={info}
        resendCooldownSeconds={resendCooldownSeconds}
      />
    );
  }

  if (step === "new-password") {
    return (
      <Box className="flex-col gap-5">
        <AuthStepHeader
          eyebrow="Almost done"
          title="Set new password"
          description="Choose a new password with at least 8 characters."
        />

        {error ? <AuthBanner tone="error" message={error} /> : null}

        <AuthField
          label="New password"
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
          secureTextEntry
          autoComplete="password-new"
          textContentType="newPassword"
          helper="Minimum 8 characters."
          error={
            touched.password && !passwordIsValid
              ? 'Password must be at least 8 characters.'
              : null
          }
        />

        <AuthPrimaryButton
          onPress={() => void handleSetPassword()}
          disabled={!canSetPassword || loading}
        >
          {loading ? 'Saving password...' : 'Set new password'}
        </AuthPrimaryButton>

        <Pressable
          onPress={() => {
            setStep("verify");
            setPassword("");
            setError("");
            setInfo("");
          }}
          accessibilityRole="button"
          accessibilityLabel="Back to code entry"
          className="self-center"
        >
          <AuthMutedText>Back to code entry</AuthMutedText>
        </Pressable>
      </Box>
    );
  }

  return (
    <Box className="flex-col gap-5">
      <AuthStepHeader
        eyebrow="Reset access"
        title="Forgot password?"
        description="Enter your email and we will send a code to reset your password."
      />

      {error ? <AuthBanner tone="error" message={error} /> : null}

      <AuthField
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={(value) => setEmail(value.trimStart())}
        onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        error={
          touched.email && !emailIsValid ? 'Enter a valid email address.' : null
        }
      />

      <AuthPrimaryButton
        onPress={() => void handleSendCode()}
        disabled={!canSendCode || loading}
      >
        {loading ? 'Sending code...' : 'Send reset code'}
      </AuthPrimaryButton>

      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to sign in"
        className="self-center"
      >
        <AuthMutedText>Back to sign in</AuthMutedText>
      </Pressable>
    </Box>
  );
}
