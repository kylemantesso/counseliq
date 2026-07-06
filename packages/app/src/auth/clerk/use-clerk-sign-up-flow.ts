import type {
  SignUpFutureResource,
  SignUpResource,
} from "@clerk/shared/types";
import { useClerk, useSignUp } from "./use-clerk-sign-up";

type SignUpParams = {
  emailAddress: string;
  password: string;
  firstName: string;
  lastName: string;
};

type SignUpHookState = {
  isLoaded?: boolean;
  fetchStatus?: "idle" | "fetching";
  signUp?: SignUpResource | SignUpFutureResource | null;
  setActive?: (params: { session: string }) => Promise<void>;
};

export type ClerkSignUpResource = SignUpResource | SignUpFutureResource;

type SignUpWithFuture = SignUpResource & {
  __internal_future?: SignUpFutureResource;
};

export function resolveSignUpFuture(
  signUp: ClerkSignUpResource,
): SignUpFutureResource | null {
  if ("password" in signUp && typeof signUp.password === "function") {
    return signUp;
  }

  const withFuture = signUp as SignUpWithFuture;
  if (
    withFuture.__internal_future &&
    typeof withFuture.__internal_future.password === "function"
  ) {
    return withFuture.__internal_future;
  }

  return null;
}

export function isFutureSignUp(signUp: ClerkSignUpResource): boolean {
  return resolveSignUpFuture(signUp) != null;
}

export function useClerkSignUpFlow() {
  const state = useSignUp() as SignUpHookState;
  const { setActive: clerkSetActive, loaded: clerkLoaded } = useClerk();

  const signUp = state.signUp ?? null;
  const setActive = state.setActive ?? clerkSetActive;

  const signUpReady =
    signUp != null &&
    (state.isLoaded === true ||
      state.fetchStatus === "idle" ||
      (state.isLoaded === undefined &&
        state.fetchStatus === undefined &&
        clerkLoaded));

  return {
    signUp,
    signUpReady,
    setActive,
  };
}

export async function submitPasswordSignUp(
  signUp: ClerkSignUpResource,
  params: SignUpParams,
  signupStarted: boolean,
): Promise<ClerkSignUpResource> {
  const future = resolveSignUpFuture(signUp);
  if (future) {
    const { error } = await future.password(params);
    if (error) throw error;
    return signUp;
  }

  const legacy = signUp as SignUpResource;
  if (signupStarted) {
    return legacy.update(params);
  }

  return legacy.create(params);
}

export async function sendSignUpEmailCode(signUp: ClerkSignUpResource): Promise<void> {
  const future = resolveSignUpFuture(signUp);
  if (future) {
    const { error } = await future.verifications.sendEmailCode();
    if (error) throw error;
    return;
  }

  await (signUp as SignUpResource).prepareEmailAddressVerification({
    strategy: "email_code",
  });
}

export async function verifySignUpEmailCode(
  signUp: ClerkSignUpResource,
  code: string,
): Promise<ClerkSignUpResource> {
  const future = resolveSignUpFuture(signUp);
  if (future) {
    const { error } = await future.verifications.verifyEmailCode({ code });
    if (error) throw error;
    return signUp;
  }

  return (signUp as SignUpResource).attemptEmailAddressVerification({ code });
}

export async function activateSignUpSession(
  signUp: ClerkSignUpResource,
  setActive: ((params: { session: string }) => Promise<void>) | undefined,
): Promise<void> {
  const future = resolveSignUpFuture(signUp);
  if (future) {
    const { error } = await future.finalize();
    if (error) throw error;
    return;
  }

  const sessionId = signUp.createdSessionId;
  if (!sessionId || !setActive) {
    throw new Error("Sign-up could not be completed. Please try again.");
  }

  await setActive({ session: sessionId });
}

export function isSignUpComplete(signUp: ClerkSignUpResource): boolean {
  const future = resolveSignUpFuture(signUp);
  if (future) return future.status === "complete";
  return signUp.status === "complete";
}

export async function startSignUpOAuthRedirect(
  signUp: ClerkSignUpResource,
  strategy: string,
  redirectUrl: string,
  redirectCallbackUrl: string,
): Promise<void> {
  const future = resolveSignUpFuture(signUp);
  if (future) {
    const { error } = await future.sso({
      strategy,
      redirectUrl,
      redirectCallbackUrl,
    });
    if (error) throw error;
    return;
  }

  await (signUp as SignUpResource).authenticateWithRedirect({
    strategy: strategy as Parameters<
      SignUpResource["authenticateWithRedirect"]
    >[0]["strategy"],
    redirectUrl: redirectCallbackUrl,
    redirectUrlComplete: redirectUrl,
  });
}
