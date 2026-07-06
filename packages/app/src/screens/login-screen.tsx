"use client";

import { useState } from "react";
import { useRouter } from "solito/navigation";
import { Link, TextLink } from "solito/link";
import {
  Box,
  Heading,
  Text,
} from "@counseliq/ui";
import { AuthScreen } from "../components/auth-screen";
import { LoadingView } from "../components/loading-spinner";
import {
  ClerkSignIn,
  type ClerkSignInStep,
} from "../components/clerk-sign-in";
import { useRedirectIfSignedIn } from "../auth/clerk/use-redirect-if-signed-in";

export function LoginScreen() {
  const router = useRouter();
  const { waiting } = useRedirectIfSignedIn();
  const [signInStep, setSignInStep] = useState<ClerkSignInStep>("credentials");

  if (waiting || signInStep === "completing") {
    return (
      <AuthScreen>
        <LoadingView containerClassName="flex-1 py-20" />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Box className="mb-6">
        <Heading size="2xl" className="mb-2">
          Welcome back
        </Heading>
        <Text className="text-muted-foreground">Sign in to your account</Text>
      </Box>

      <ClerkSignIn onStepChange={setSignInStep} />

      <Box className="mt-6 flex-row justify-center gap-1">
        <Text className="text-muted-foreground">No account?</Text>
        <TextLink href="/signup">
          <Text className="text-primary font-semibold">Sign up</Text>
        </TextLink>
      </Box>

      <Box className="mt-4">
        <TextLink href="/">
          <Text className="text-muted-foreground text-center">Back to home</Text>
        </TextLink>
      </Box>
    </AuthScreen>
  );
}
