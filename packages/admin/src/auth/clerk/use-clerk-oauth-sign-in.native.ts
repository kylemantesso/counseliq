import { useSSO } from "@clerk/clerk-expo";
import { completeNativeOAuth } from "./complete-native-oauth";
import { useClerk, useSignIn } from "./use-clerk-sign-in";
import type { OAuthStrategy } from "./oauth-strategy";
import type { OAuthResult } from "./oauth-result";

export function useClerkOAuthSignIn() {
  const { startSSOFlow } = useSSO();
  const { setActive: signInSetActive } = useSignIn();
  const { setActive: clerkSetActive } = useClerk();
  const setActive = signInSetActive ?? clerkSetActive;

  const startOAuth = async (strategy: OAuthStrategy): Promise<OAuthResult> => {
    const flow = await startSSOFlow({ strategy });
    return completeNativeOAuth(flow, setActive);
  };

  return { startOAuth };
}
