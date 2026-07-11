import { useSSO } from "@clerk/clerk-expo";
import { completeNativeOAuth } from "./complete-native-oauth";
import { useClerk, useSignUp } from "./use-clerk-sign-up";
import type { OAuthStrategy } from "./oauth-strategy";
import type { OAuthResult } from "./oauth-result";

export function useClerkOAuthSignUp() {
  const { startSSOFlow } = useSSO();
  const { setActive: signUpSetActive } = useSignUp();
  const { setActive: clerkSetActive } = useClerk();
  const setActive = signUpSetActive ?? clerkSetActive;

  const startOAuth = async (
    strategy: OAuthStrategy,
    _redirectUrlComplete?: string,
  ): Promise<OAuthResult> => {
    const flow = await startSSOFlow({ strategy });
    return completeNativeOAuth(flow, setActive);
  };

  return { startOAuth };
}
