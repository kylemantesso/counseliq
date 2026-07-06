"use client";

import { useState } from "react";
import { TextLink } from "solito/link";
import { Box, Heading, Text } from "@app-template/ui";
import { AuthScreen } from "../components/auth-screen";
import { LoadingView } from "../components/loading-spinner";
import { ClerkSignUp } from "../components/clerk-sign-up";
import { useRedirectIfSignedIn } from "../auth/clerk/use-redirect-if-signed-in";

export function SignupScreen() {
  const { waiting } = useRedirectIfSignedIn();
  const [finalizing, setFinalizing] = useState(false);

  if (waiting || finalizing) {
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
          Create account
        </Heading>
        <Text className="text-muted-foreground">Get started in a few steps</Text>
      </Box>

      <ClerkSignUp
        onFinalizingChange={setFinalizing}
        header={null}
      />

      <Box className="mt-6 flex-row justify-center gap-1">
        <Text className="text-muted-foreground">Already have an account?</Text>
        <TextLink href="/login">
          <Text className="text-primary font-semibold">Sign in</Text>
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
