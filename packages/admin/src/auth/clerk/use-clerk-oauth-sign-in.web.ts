import { getClerkAllowedRedirectOrigins } from "./clerk-redirect-origins";
import {
  startSignInOAuthRedirect,
  useClerkSignInFlow,
} from "./use-clerk-sign-in-flow";
import type { OAuthStrategy } from "./oauth-strategy";
import type { OAuthResult } from "./oauth-result";

function getOAuthWebOrigin(): string {
  return getClerkAllowedRedirectOrigins()[0] ?? "http://localhost:3005";
}

export function useClerkOAuthSignIn() {
  const { signIn, signInReady } = useClerkSignInFlow();

  const startOAuth = async (
    strategy: OAuthStrategy,
    redirectUrlComplete = "/admin",
  ): Promise<OAuthResult> => {
    if (!signInReady || !signIn) {
      return { type: "incomplete" };
    }

    const origin = getOAuthWebOrigin();
    const redirectUrl = redirectUrlComplete.startsWith("http")
      ? redirectUrlComplete
      : `${origin}${redirectUrlComplete}`;

    await startSignInOAuthRedirect(
      signIn,
      strategy,
      redirectUrl,
      `${origin}/sso-callback`,
    );

    return { type: "redirect" };
  };

  return { startOAuth, signInReady };
}
