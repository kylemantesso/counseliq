import type { OAuthStrategy } from "./oauth-strategy";
import type {
  SignInFutureResource,
  SignInResource,
  SignInStatus,
} from "@clerk/shared/types";
import { useClerk, useSignIn } from "./use-clerk-sign-in";

type SignInParams = {
  identifier: string;
  password: string;
};

type SignInHookState = {
  isLoaded?: boolean;
  fetchStatus?: "idle" | "fetching";
  signIn?: SignInResource | SignInFutureResource | null;
  setActive?: (params: { session: string }) => Promise<void>;
};

export type ClerkSignInResource = SignInResource | SignInFutureResource;

type SignInWithFuture = SignInResource & {
  __internal_future?: SignInFutureResource;
};

/**
 * Web (@clerk/react v6) returns a standalone Future sign-in resource.
 * Native (@clerk/clerk-react v5) wraps it on `signIn.__internal_future`.
 */
export function resolveSignInFuture(
  signIn: ClerkSignInResource,
): SignInFutureResource | null {
  if (
    "password" in signIn &&
    typeof signIn.password === "function" &&
    !("attemptFirstFactor" in signIn)
  ) {
    return signIn as SignInFutureResource;
  }

  const withFuture = signIn as SignInWithFuture;
  if (
    withFuture.__internal_future &&
    typeof withFuture.__internal_future.password === "function"
  ) {
    return withFuture.__internal_future;
  }

  return null;
}

/**
 * Web (@clerk/react v6) exposes the Signals sign-in object with `password` +
 * `finalize` on the resource itself. Native (@clerk/clerk-react v5 via
 * clerk-expo) exposes the legacy `SignIn` class — use `create()` + `setActive`,
 * or `__internal_future.password()` + `finalize()` when present.
 */
export function usesClerkSignInSignals(
  signIn: ClerkSignInResource,
): signIn is SignInFutureResource {
  return resolveSignInFuture(signIn) != null;
}

function asLegacySignIn(signIn: ClerkSignInResource): SignInResource {
  return signIn as SignInResource;
}

export function getSignInStatus(
  signIn: ClerkSignInResource,
): SignInStatus | null {
  const future = resolveSignInFuture(signIn);
  if (future) return future.status;
  return asLegacySignIn(signIn).status ?? null;
}

export function getSignInCreatedSessionId(
  signIn: ClerkSignInResource,
): string | null {
  const future = resolveSignInFuture(signIn);
  if (future?.createdSessionId) return future.createdSessionId;
  return asLegacySignIn(signIn).createdSessionId ?? null;
}

export function signInNeedsEmailVerification(
  signIn: ClerkSignInResource,
): boolean {
  if (getSignInStatus(signIn) === "needs_second_factor") {
    return true;
  }

  const legacy = asLegacySignIn(signIn);
  const hasEmailCodeSecondFactor =
    legacy.supportedSecondFactors?.some(
      (factor) => factor.strategy === "email_code",
    ) ?? false;

  return (
    legacy.firstFactorVerification?.status === "verified" &&
    getSignInStatus(signIn) !== "complete" &&
    hasEmailCodeSecondFactor
  );
}

export function logSignInDebug(
  label: string,
  signIn: ClerkSignInResource,
  extra?: Record<string, unknown>,
): void {
  if (!__DEV__) return;

  const future = resolveSignInFuture(signIn);
  const legacy = asLegacySignIn(signIn);

  console.log(`[sign-in] ${label}`, {
    usesFutureApi: future != null,
    status: getSignInStatus(signIn),
    legacyStatus: legacy.status,
    futureStatus: future?.status,
    createdSessionId: getSignInCreatedSessionId(signIn),
    firstFactorVerification: legacy.firstFactorVerification?.status,
    secondFactorVerification: legacy.secondFactorVerification?.status,
    clientTrustState: legacy.clientTrustState,
    supportedSecondFactors: legacy.supportedSecondFactors?.map(
      (factor) => factor.strategy,
    ),
    ...extra,
  });
}

export function useClerkSignInFlow() {
  const state = useSignIn() as SignInHookState;
  const { setActive: clerkSetActive, loaded: clerkLoaded } = useClerk();

  const signIn = state.signIn ?? null;
  const setActive = state.setActive ?? clerkSetActive;

  const signInReady =
    signIn != null &&
    (state.isLoaded === true ||
      state.fetchStatus === "idle" ||
      (state.isLoaded === undefined &&
        state.fetchStatus === undefined &&
        clerkLoaded));

  return {
    signIn,
    signInReady,
    setActive,
  };
}

export async function submitPasswordSignIn(
  signIn: ClerkSignInResource,
  params: SignInParams,
): Promise<ClerkSignInResource> {
  const future = resolveSignInFuture(signIn);
  if (future) {
    const { error } = await future.password({
      identifier: params.identifier,
      password: params.password,
    });
    if (error) throw error;
    return signIn;
  }

  const legacy = asLegacySignIn(signIn);
  let result = await legacy.create({
    strategy: "password",
    identifier: params.identifier,
    password: params.password,
  });

  if (result.status === "needs_first_factor") {
    await legacy.create({ identifier: params.identifier });
    result = await legacy.attemptFirstFactor({
      strategy: "password",
      password: params.password,
    });
  }

  return result;
}

export async function sendSignInEmailMfaCode(
  signIn: ClerkSignInResource,
  emailAddress: string,
): Promise<void> {
  const future = resolveSignInFuture(signIn);
  if (future) {
    const { error } = await future.emailCode.sendCode({ emailAddress });
    if (error) throw error;
    return;
  }

  const legacy = asLegacySignIn(signIn);
  const emailCodeFactor = legacy.supportedSecondFactors?.find(
    (factor) => factor.strategy === "email_code",
  );
  if (!emailCodeFactor || !("emailAddressId" in emailCodeFactor)) {
    throw new Error(
      "Email verification is required, but this account cannot use email codes.",
    );
  }

  await legacy.prepareSecondFactor({
    strategy: "email_code",
    emailAddressId: emailCodeFactor.emailAddressId,
  });
}

export async function verifySignInEmailMfaCode(
  signIn: ClerkSignInResource,
  code: string,
): Promise<ClerkSignInResource> {
  const future = resolveSignInFuture(signIn);
  if (future) {
    const { error } = await future.emailCode.verifyCode({ code });
    if (error) throw error;
    return signIn;
  }

  return asLegacySignIn(signIn).attemptSecondFactor({
    strategy: "email_code",
    code,
  });
}

export async function activateSignInSession(
  signIn: ClerkSignInResource,
  setActive: ((params: { session: string }) => Promise<void>) | undefined,
): Promise<void> {
  if (getSignInStatus(signIn) !== "complete") {
    throw new Error("Sign-in is not complete yet.");
  }

  const future = resolveSignInFuture(signIn);
  if (future) {
    const { error } = await future.finalize();
    if (error) throw error;
    return;
  }

  const sessionId = getSignInCreatedSessionId(signIn);
  if (!sessionId || !setActive) {
    throw new Error("Sign-in could not be completed. Please try again.");
  }

  await setActive({ session: sessionId });
}

export function isSignInComplete(signIn: ClerkSignInResource): boolean {
  return getSignInStatus(signIn) === "complete";
}

export function signInNeedsNewPassword(signIn: ClerkSignInResource): boolean {
  return getSignInStatus(signIn) === "needs_new_password";
}

export async function createSignInWithIdentifier(
  signIn: ClerkSignInResource,
  identifier: string,
): Promise<ClerkSignInResource> {
  const future = resolveSignInFuture(signIn);
  if (future) {
    const { error } = await future.create({ identifier });
    if (error) throw error;
    return signIn;
  }

  return asLegacySignIn(signIn).create({ identifier });
}

export async function sendResetPasswordEmailCode(
  signIn: ClerkSignInResource,
): Promise<void> {
  const future = resolveSignInFuture(signIn);
  if (future) {
    const { error } = await future.resetPasswordEmailCode.sendCode();
    if (error) throw error;
    return;
  }

  const legacy = asLegacySignIn(signIn);
  const resetFactor = legacy.supportedFirstFactors?.find(
    (factor) => factor.strategy === "reset_password_email_code",
  );
  if (!resetFactor || !("emailAddressId" in resetFactor)) {
    throw new Error(
      "Password reset via email is not available for this account.",
    );
  }

  await legacy.prepareFirstFactor({
    strategy: "reset_password_email_code",
    emailAddressId: resetFactor.emailAddressId,
  });
}

export async function verifyResetPasswordEmailCode(
  signIn: ClerkSignInResource,
  code: string,
): Promise<ClerkSignInResource> {
  const future = resolveSignInFuture(signIn);
  if (future) {
    const { error } = await future.resetPasswordEmailCode.verifyCode({ code });
    if (error) throw error;
    return signIn;
  }

  return asLegacySignIn(signIn).attemptFirstFactor({
    strategy: "reset_password_email_code",
    code,
  });
}

export async function submitResetPassword(
  signIn: ClerkSignInResource,
  password: string,
  signOutOfOtherSessions = true,
): Promise<ClerkSignInResource> {
  const future = resolveSignInFuture(signIn);
  if (future) {
    const { error } = await future.resetPasswordEmailCode.submitPassword({
      password,
      signOutOfOtherSessions,
    });
    if (error) throw error;
    return signIn;
  }

  return asLegacySignIn(signIn).resetPassword({
    password,
    signOutOfOtherSessions,
  });
}

/** @deprecated Use usesClerkSignInSignals */
export function isFutureSignIn(signIn: ClerkSignInResource): boolean {
  return usesClerkSignInSignals(signIn);
}

export async function startSignInOAuthRedirect(
  signIn: ClerkSignInResource,
  strategy: OAuthStrategy,
  redirectUrl: string,
  redirectCallbackUrl: string,
): Promise<void> {
  const future = resolveSignInFuture(signIn);
  if (future) {
    const { error } = await future.sso({
      strategy,
      redirectUrl,
      redirectCallbackUrl,
    });
    if (error) throw error;
    return;
  }

  await asLegacySignIn(signIn).authenticateWithRedirect({
    strategy,
    redirectUrl: redirectCallbackUrl,
    redirectUrlComplete: redirectUrl,
  });
}
