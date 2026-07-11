"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { Box } from "@counseliq/ui";
import { useRouter } from "solito/navigation";
import {
  AuthDivider,
  AuthField,
  AuthPrimaryButton,
  AuthStepHeader,
} from "./auth-form";
import { clerkErrorMessage } from "../auth/clerk/clerk-errors";
import { LoadingSpinner } from "./loading-spinner";
import { isSessionExistsError } from "../auth/clerk/is-session-exists-error";
import { useClerkOAuthSignUp } from "../auth/clerk/use-clerk-oauth-sign-up";
import type { OAuthStrategy } from "../auth/clerk/oauth-strategy";
import { ClerkCaptcha } from "./clerk-captcha";
import {
  activateSignUpSession,
  isSignUpComplete,
  sendSignUpEmailCode,
  submitPasswordSignUp,
  useClerkSignUpFlow,
  verifySignUpEmailCode,
  type ClerkSignUpResource,
} from "../auth/clerk/use-clerk-sign-up-flow";
import { EMAIL_REGEX } from "../constants";
import { AuthBanner } from "./auth-banner";
import { EmailVerificationStep } from "./email-verification-step";
import { OAuthButton } from "./oauth-button";

const RESEND_COOLDOWN_SECONDS = 60;

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName };
}

type SignUpStep = "details" | "verify" | "completing";

type ClerkSignUpProps = {
  /** When set (onboarding flow), redirect is handled after Convex onboarding completes. */
  deferRedirect?: boolean;
  /** OAuth return URL after provider auth (web only). */
  oauthRedirectComplete?: string;
  /**
   * When true, the parent owns the "completing" state UI (e.g. the onboarding
   * AccountStep renders its own spinner). This component returns null in that
   * state so headings aren't duplicated.
   */
  embedded?: boolean;
  /**
   * Fired when signup finalization begins (email verify submit, session
   * activation, etc.). Used by onboarding to show a full-screen loading bridge
   * before Clerk `isSignedIn` and Convex onboarding complete.
   */
  onFinalizingChange?: (finalizing: boolean) => void;
  /**
   * Optional page header (title + subtitle) rendered above the details form
   * only. Hidden on `verify` and `completing` steps so those steps can render
   * their own contextual heading without stacking.
   */
  header?: ReactNode;
};

export function ClerkSignUp({
  deferRedirect = false,
  oauthRedirectComplete,
  embedded = false,
  onFinalizingChange,
  header,
}: ClerkSignUpProps = {}) {
  const { signUp, signUpReady, setActive } = useClerkSignUpFlow();
  const { startOAuth } = useClerkOAuthSignUp();
  const router = useRouter();

  const [step, setStep] = useState<SignUpStep>("details");
  const [signupStarted, setSignupStarted] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [touched, setTouched] = useState({
    name: false,
    email: false,
    password: false,
  });

  const nameIsValid = name.trim().length >= 2;
  const emailIsValid = EMAIL_REGEX.test(email.trim());
  const passwordIsValid = password.length >= 8;
  const canSubmit =
    nameIsValid && emailIsValid && passwordIsValid && !loading && signUpReady;

  const oauthRedirectCompleteUrl =
    oauthRedirectComplete ?? (deferRedirect ? "/onboarding/account" : "/admin");
  const finalizeStarted = useRef(false);

  const beginFinalizing = () => {
    if (!deferRedirect) return;
    onFinalizingChange?.(true);
    setStep("completing");
  };

  const completeSignup = async (result: ClerkSignUpResource) => {
    if (finalizeStarted.current) return;
    finalizeStarted.current = true;

    try {
      await activateSignUpSession(result, setActive);
      if (deferRedirect) {
        beginFinalizing();
        return;
      }
      router.replace("/admin");
    } catch (err: unknown) {
      finalizeStarted.current = false;
      if (isSessionExistsError(err)) {
        if (deferRedirect) {
          beginFinalizing();
        } else {
          router.replace("/admin");
        }
        return;
      }
      onFinalizingChange?.(false);
      throw err;
    }
  };

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setResendCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldownSeconds]);

  const finalizeSignup = async (result: ClerkSignUpResource) => {
    await completeSignup(result);
  };

  useEffect(() => {
    if (!signUpReady || !signUp || finalizeStarted.current) return;
    if (signUp.status !== "complete") return;

    void (async () => {
      try {
        await finalizeSignup(signUp);
      } catch (err: unknown) {
        setError(clerkErrorMessage(err, "Sign-up could not be completed."));
      }
    })();
  }, [signUpReady, signUp, deferRedirect, setActive, router]);

  const goToVerifyStep = () => {
    setStep("verify");
    setCode("");
    setError("");
    setInfo("");
    setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
  };

  const prepareVerification = async () => {
    if (!signUp) return;
    await sendSignUpEmailCode(signUp);
    goToVerifyStep();
  };

  const handleSubmit = async () => {
    setError("");
    setInfo("");
    setTouched({ name: true, email: true, password: true });

    if (!nameIsValid) {
      setError("Enter your full name (at least 2 characters).");
      return;
    }
    if (!emailIsValid) {
      setError("Enter a valid email address.");
      return;
    }
    if (!passwordIsValid) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!signUpReady || !signUp) return;

    const { firstName, lastName } = splitName(name);
    const trimmedEmail = email.trim();

    setLoading(true);
    try {
      const result = await submitPasswordSignUp(
        signUp,
        {
          emailAddress: trimmedEmail,
          password,
          firstName,
          lastName,
        },
        signupStarted,
      );

      setSignupStarted(true);

      if (isSignUpComplete(result)) {
        await completeSignup(result);
        return;
      }

      await prepareVerification();
    } catch (err: unknown) {
      setError(clerkErrorMessage(err, "Signup failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError("");
    setInfo("");
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    if (!signUp) {
      setError("Sign-up session expired. Go back and try again.");
      return;
    }

    setLoading(true);
    if (deferRedirect) {
      onFinalizingChange?.(true);
    }
    try {
      await verifySignUpEmailCode(signUp, code);
      await completeSignup(signUp);
    } catch (err: unknown) {
      if (isSessionExistsError(err)) {
        if (deferRedirect) {
          beginFinalizing();
        } else {
          router.replace("/admin");
        }
        return;
      }
      onFinalizingChange?.(false);
      finalizeStarted.current = false;
      setError(clerkErrorMessage(err, "Invalid or expired code. Try again or resend."));
    } finally {
      if (!deferRedirect) {
        setLoading(false);
      }
    }
  };

  const handleResend = async () => {
    if (resendCooldownSeconds > 0 || resending || !signUp) return;

    setError("");
    setInfo("");
    setResending(true);
    try {
      await sendSignUpEmailCode(signUp);
      setInfo("A new code was sent to your email.");
      setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    } catch (err: unknown) {
      setError(clerkErrorMessage(err, "Could not resend the code. Please try again."));
    } finally {
      setResending(false);
    }
  };

  const handleChangeEmail = () => {
    setStep("details");
    setCode("");
    setError("");
    setInfo("");
    setResendCooldownSeconds(0);
  };

  const handleOAuth = async (strategy: OAuthStrategy) => {
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const result = await startOAuth(strategy, oauthRedirectCompleteUrl);

      if (result.type === "redirect") {
        return;
      }

      if (result.type === "cancelled") {
        return;
      }

      if (result.type === "complete") {
        if (!deferRedirect) {
          router.replace("/admin");
        }
        return;
      }

      setError("Sign-up could not be completed.");
    } catch (err: unknown) {
      setError(clerkErrorMessage(err, "Sign-up failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const showAppleOAuth = Platform.OS === "ios" || Platform.OS === "web";

  if (step === "completing") {
    if (embedded) {
      return null;
    }
    return (
      <Box className="items-stretch gap-3">
        <AuthStepHeader
          title="Setting up your account"
          description="Saving your club and team details…"
        />
        <Box className="mt-6 items-center">
          <LoadingSpinner />
        </Box>
      </Box>
    );
  }

  if (step === "verify") {
    return (
      <EmailVerificationStep
        flow="sign-up"
        email={email.trim()}
        code={code}
        onCodeChange={setCode}
        onVerify={() => void handleVerify()}
        onResend={() => void handleResend()}
        onChangeEmail={handleChangeEmail}
        loading={loading}
        resending={resending}
        error={error}
        info={info}
        resendCooldownSeconds={resendCooldownSeconds}
      />
    );
  }

  return (
    <Box className="flex-col gap-5">
      {header ? <Box>{header}</Box> : null}

      {error ? <AuthBanner tone="error" message={error} /> : null}

      <AuthField
        label="Full name"
        placeholder="Alex Johnson"
        value={name}
        onChangeText={setName}
        onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
        autoComplete="name"
        textContentType="name"
        error={
          touched.name && !nameIsValid
            ? 'Name should be at least 2 characters.'
            : null
        }
      />

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

      <AuthField
        label="Password"
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

      <ClerkCaptcha />

      <AuthPrimaryButton
        onPress={() => void handleSubmit()}
        disabled={!canSubmit || loading}
      >
        {loading ? 'Creating account...' : 'Create account'}
      </AuthPrimaryButton>

      <AuthDivider />

      <Box className="flex-col">
        <OAuthButton
          provider="google"
          label="Sign up with Google"
          onPress={() => void handleOAuth("oauth_google")}
          disabled={loading}
        />
        {showAppleOAuth ? (
          <OAuthButton
            provider="apple"
            label="Sign up with Apple"
            onPress={() => void handleOAuth("oauth_apple")}
            disabled={loading}
          />
        ) : null}
      </Box>
    </Box>
  );
}
