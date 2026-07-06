import type { SetActive, SignInResource, SignUpResource } from "@clerk/shared/types";
import type { WebBrowserAuthSessionResult } from "expo-web-browser";
import type { OAuthResult } from "./oauth-result";
import {
  activateSignInSession,
  getSignInCreatedSessionId,
  getSignInStatus,
  type ClerkSignInResource,
} from "./use-clerk-sign-in-flow";
import {
  activateSignUpSession,
  isFutureSignUp,
  type ClerkSignUpResource,
} from "./use-clerk-sign-up-flow";

type NativeOAuthFlowResult = {
  createdSessionId: string | null;
  setActive?: SetActive;
  signIn?: SignInResource | ClerkSignInResource | null;
  signUp?: SignUpResource | ClerkSignUpResource | null;
  authSessionResult?: WebBrowserAuthSessionResult | null;
};

export async function completeNativeOAuth(
  flow: NativeOAuthFlowResult,
  fallbackSetActive?: SetActive,
): Promise<OAuthResult> {
  if (
    flow.authSessionResult?.type === "cancel" ||
    flow.authSessionResult?.type === "dismiss"
  ) {
    return { type: "cancelled" };
  }

  const setActive = flow.setActive ?? fallbackSetActive;
  const sessionId = flow.createdSessionId;

  if (sessionId && setActive) {
    await setActive({ session: sessionId });
    return { type: "complete", sessionId };
  }

  const signIn = flow.signIn;
  if (signIn) {
    const status = getSignInStatus(signIn);
    if (status === "needs_second_factor") {
      throw new Error(
        "Email verification is required to finish signing in on this device.",
      );
    }
    if (status === "complete") {
      const resolvedSessionId = getSignInCreatedSessionId(signIn);
      await activateSignInSession(signIn, setActive);
      return {
        type: "complete",
        sessionId: resolvedSessionId ?? undefined,
      };
    }
  }

  const signUp = flow.signUp;
  if (signUp && isFutureSignUp(signUp) && signUp.status === "complete") {
    await activateSignUpSession(signUp, setActive);
    return { type: "complete" };
  }

  if (
    signUp &&
    !isFutureSignUp(signUp) &&
    signUp.status === "complete" &&
    signUp.createdSessionId &&
    setActive
  ) {
    await setActive({ session: signUp.createdSessionId });
    return { type: "complete", sessionId: signUp.createdSessionId };
  }

  return { type: "incomplete" };
}
