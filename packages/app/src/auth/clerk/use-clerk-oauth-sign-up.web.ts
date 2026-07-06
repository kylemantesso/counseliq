import { getClerkAllowedRedirectOrigins } from "./clerk-redirect-origins";
import { startSignUpOAuthRedirect, useClerkSignUpFlow } from "./use-clerk-sign-up-flow";
import type { OAuthStrategy } from "./oauth-strategy";
import type { OAuthResult } from "./oauth-result";

function getOAuthWebOrigin(): string {
  return getClerkAllowedRedirectOrigins()[0] ?? "http://localhost:3000";
}

export function useClerkOAuthSignUp() {
  const { signUp, signUpReady } = useClerkSignUpFlow();

  const startOAuth = async (
    strategy: OAuthStrategy,
    redirectUrlComplete: string
  ): Promise<OAuthResult> => {
    if (!signUpReady || !signUp) {
      return { type: "incomplete" };
    }

    const origin = getOAuthWebOrigin();
    const redirectUrl = redirectUrlComplete.startsWith("http")
      ? redirectUrlComplete
      : `${origin}${redirectUrlComplete}`;

    await startSignUpOAuthRedirect(
      signUp,
      strategy,
      redirectUrl,
      `${origin}/sso-callback`,
    );

    return { type: "redirect" };
  };

  return { startOAuth };
}
