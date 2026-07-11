'use client';

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'solito/navigation';
import { Box, Pressable } from '@counseliq/ui';
import {
  AuthDivider,
  AuthField,
  AuthLinkText,
  AuthPrimaryButton,
} from './auth-form';
import { clerkErrorMessage } from '../auth/clerk/clerk-errors';
import { isSessionExistsError } from '../auth/clerk/is-session-exists-error';
import { useClerkOAuthSignIn } from '../auth/clerk/use-clerk-oauth-sign-in';
import type { OAuthStrategy } from '../auth/clerk/oauth-strategy';
import {
  activateSignInSession,
  getSignInStatus,
  isSignInComplete,
  logSignInDebug,
  sendSignInEmailMfaCode,
  signInNeedsEmailVerification,
  submitPasswordSignIn,
  useClerkSignInFlow,
  verifySignInEmailMfaCode,
} from '../auth/clerk/use-clerk-sign-in-flow';
import { useAuth as useClerkAuth } from '../auth/clerk/use-clerk-auth';
import { EMAIL_REGEX } from '../constants';
import { AuthBanner } from './auth-banner';
import { AnalyticsEvent } from '../analytics/events';
import { trackProductEvent } from '../analytics/track-product-event';
import { EmailVerificationStep } from './email-verification-step';
import { OAuthButton } from './oauth-button';
import { ForgotPasswordFlow } from './forgot-password-flow';

const RESEND_COOLDOWN_SECONDS = 60;

export type ClerkSignInStep =
  | 'credentials'
  | 'verify'
  | 'forgot-password'
  | 'completing';

type ClerkSignInProps = {
  onStepChange?: (step: ClerkSignInStep) => void;
};

export function ClerkSignIn({ onStepChange }: ClerkSignInProps = {}) {
  const { signIn, signInReady, setActive } = useClerkSignInFlow();
  const { isSignedIn } = useClerkAuth();
  const { startOAuth } = useClerkOAuthSignIn();
  const router = useRouter();

  const [step, setStep] = useState<ClerkSignInStep>('credentials');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [touched, setTouched] = useState({ email: false, password: false });

  const emailIsValid = EMAIL_REGEX.test(email.trim());
  const passwordIsValid = password.length >= 8;
  const canSubmit = emailIsValid && passwordIsValid && !loading && signInReady;

  useEffect(() => {
    onStepChange?.(showForgotPassword ? 'forgot-password' : step);
  }, [onStepChange, showForgotPassword, step]);

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setResendCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldownSeconds]);

  const finishSignIn = async (
    result: NonNullable<typeof signIn>,
    method: 'password' | 'email_verification' | 'oauth' = 'password',
  ): Promise<void> => {
    setStep('completing');
    await activateSignInSession(result, setActive);
    trackProductEvent(AnalyticsEvent.AUTH_SIGN_IN_COMPLETED, 'auth', {
      method,
    });
    router.replace('/home');
  };

  const handleSubmit = async () => {
    setError('');
    setInfo('');
    setTouched({ email: true, password: true });

    if (!emailIsValid) {
      setError('Enter a valid email address.');
      return;
    }
    if (!passwordIsValid) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!signInReady || !signIn) return;

    if (isSignedIn) {
      router.replace('/home');
      return;
    }

    setLoading(true);
    let completed = false;
    try {
      logSignInDebug('before password submit', signIn, {
        hasSetActive: typeof setActive === 'function',
      });

      const result = await submitPasswordSignIn(signIn, {
        identifier: email.trim(),
        password,
      });

      logSignInDebug('after password submit', result);

      if (isSignInComplete(result)) {
        await finishSignIn(result, 'password');
        completed = true;
        return;
      }

      if (signInNeedsEmailVerification(result)) {
        await sendSignInEmailMfaCode(result, email.trim());
        setCode('');
        setStep('verify');
        setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
        return;
      }

      const status = getSignInStatus(result);
      logSignInDebug('unhandled sign-in state', result, { status });
      setError(
        __DEV__ && status
          ? `Sign-in could not be completed (${status}). Check your credentials.`
          : 'Sign-in could not be completed. Check your credentials.',
      );
    } catch (err: unknown) {
      logSignInDebug('password submit error', signIn, {
        error: err instanceof Error ? err.message : String(err),
      });
      if (isSessionExistsError(err)) {
        setStep('completing');
        router.replace('/home');
        completed = true;
        return;
      }
      setError(clerkErrorMessage(err, 'Login failed. Check your email and password.'));
      trackProductEvent(AnalyticsEvent.AUTH_SIGN_IN_FAILED, 'auth', {
        method: 'password',
      });
    } finally {
      if (!completed) {
        setLoading(false);
      }
    }
  };

  const handleVerify = async () => {
    setError('');
    setInfo('');
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    if (!signIn) {
      setError('Sign-in session expired. Go back and try again.');
      return;
    }

    setLoading(true);
    let completed = false;
    try {
      const result = await verifySignInEmailMfaCode(signIn, code);
      if (!isSignInComplete(result)) {
        setError('Verification did not complete sign-in. Try again.');
        return;
      }
      await finishSignIn(result, 'email_verification');
      completed = true;
    } catch (err: unknown) {
      if (isSessionExistsError(err)) {
        setStep('completing');
        router.replace('/home');
        completed = true;
        return;
      }
      setError(clerkErrorMessage(err, 'Invalid or expired code. Try again or resend.'));
    } finally {
      if (!completed) {
        setLoading(false);
      }
    }
  };

  const handleResend = async () => {
    if (!signIn || resendCooldownSeconds > 0) return;
    setError('');
    setInfo('');
    setResending(true);
    try {
      await sendSignInEmailMfaCode(signIn, email.trim());
      setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
      setInfo('We sent a new verification code.');
    } catch (err: unknown) {
      setError(clerkErrorMessage(err, 'Could not resend the code. Try again.'));
    } finally {
      setResending(false);
    }
  };

  const handleOAuth = async (strategy: OAuthStrategy) => {
    setError('');
    setLoading(true);
    try {
      const result = await startOAuth(strategy);

      if (result.type === 'redirect' || result.type === 'cancelled') {
        return;
      }

      if (result.type === 'complete') {
        trackProductEvent(AnalyticsEvent.AUTH_SIGN_IN_COMPLETED, 'auth', {
          method: 'oauth',
          strategy,
        });
        router.replace('/home');
        return;
      }

      setError('Sign-in could not be completed.');
    } catch (err: unknown) {
      if (isSessionExistsError(err)) {
        router.replace('/home');
        return;
      }
      trackProductEvent(AnalyticsEvent.AUTH_SIGN_IN_FAILED, 'auth', {
        method: 'oauth',
        strategy,
      });
      setError(clerkErrorMessage(err, 'Sign-in failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const showAppleOAuth = Platform.OS === 'ios' || Platform.OS === 'web';

  if (showForgotPassword) {
    return (
      <ForgotPasswordFlow
        initialEmail={email}
        onBack={() => {
          setShowForgotPassword(false);
          setError('');
          setInfo('');
        }}
      />
    );
  }

  if (step === 'verify') {
    return (
      <EmailVerificationStep
        flow="sign-in"
        email={email.trim()}
        code={code}
        onCodeChange={setCode}
        onVerify={() => void handleVerify()}
        onResend={() => void handleResend()}
        onChangeEmail={() => {
          setStep('credentials');
          setCode('');
          setError('');
          setInfo('');
        }}
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

      <AuthField
        label="Password"
        placeholder="••••••••"
        value={password}
        onChangeText={setPassword}
        onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        helper="Minimum 8 characters."
        error={
          touched.password && !passwordIsValid
            ? 'Password must be at least 8 characters.'
            : null
        }
      />

      <Pressable
        onPress={() => {
          setShowForgotPassword(true);
          setError('');
          setInfo('');
        }}
        accessibilityRole="button"
        accessibilityLabel="Forgot password"
        className="-mt-2 self-end"
      >
        <AuthLinkText className="text-accent">Forgot password?</AuthLinkText>
      </Pressable>

      <AuthPrimaryButton
        onPress={() => void handleSubmit()}
        disabled={!canSubmit || loading}
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </AuthPrimaryButton>

      <AuthDivider />

      <Box className="flex-col">
        <OAuthButton
          provider="google"
          label="Sign in with Google"
          onPress={() => void handleOAuth('oauth_google')}
          disabled={loading || !signInReady}
        />
        {showAppleOAuth ? (
          <OAuthButton
            provider="apple"
            label="Sign in with Apple"
            onPress={() => void handleOAuth('oauth_apple')}
            disabled={loading || !signInReady}
          />
        ) : null}
      </Box>
    </Box>
  );
}
