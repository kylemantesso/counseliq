"use client";

import { Box, Button, ButtonText, Heading, Text } from "@counseliq/ui";
import { AuthGuard } from "../components/auth-guard";
import { Screen } from "../components/screen";
import { useAuth } from "../auth";

export function ClientHomeScreen() {
  return (
    <AuthGuard>
      <ClientHomeContent />
    </AuthGuard>
  );
}

function ClientHomeContent() {
  const { user, logout } = useAuth();

  return (
    <Screen className="flex-1 bg-background" padding={{ top: 24, bottom: 24 }}>
      <Box className="flex-1 items-center justify-center px-6">
        <Box className="w-full max-w-[560px] gap-5 rounded-3xl border border-border bg-card p-6 shadow-sm">
          <Box className="gap-2">
            <Text className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              CounselIQ Client
            </Text>
            <Heading size="2xl">Welcome{user?.name ? `, ${user.name}` : ""}</Heading>
            <Text className="text-muted-foreground">
              You are signed in. This is the starting point for the client app.
            </Text>
          </Box>

          <Button variant="outline" onPress={() => void logout()}>
            <ButtonText>Sign out</ButtonText>
          </Button>
        </Box>
      </Box>
    </Screen>
  );
}
