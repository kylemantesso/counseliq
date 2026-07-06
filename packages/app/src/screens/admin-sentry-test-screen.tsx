"use client";

import { useState } from "react";
import { ScrollView } from "@app-template/ui";
import { useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  Text,
} from "@app-template/ui";
import { AdminGuard } from "../components/admin-guard";
import { Screen } from "../components/screen";
import {
  captureAdminSentryTestException,
  captureAdminSentryTestMessage,
  isAdminSentryConfigured,
} from "../observability/capture-admin-sentry-test";

export function AdminSentryTestScreen() {
  return (
    <AdminGuard>
      <AdminSentryTestContent />
    </AdminGuard>
  );
}

function AdminSentryTestContent() {
  const router = useRouter();
  const [result, setResult] = useState("");
  const configured = isAdminSentryConfigured();

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center">
        <Heading size="md">Test Sentry</Heading>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <ButtonText>Back</ButtonText>
        </Button>
      </Box>
      <ScrollView className="flex-1 w-full">
        <Box className="flex-col gap-4 p-6">
        <Text className="text-muted-foreground">
          {configured
            ? "Sentry DSN is configured for this build."
            : "Sentry DSN is not configured — events will not be sent."}
        </Text>
        <Button
          variant="outline"
          onPress={() => {
            captureAdminSentryTestMessage();
            setResult("Sent test message to Sentry.");
          }}
        >
          <ButtonText>Send test message</ButtonText>
        </Button>
        <Button
          variant="default"
          onPress={() => {
            captureAdminSentryTestException();
            setResult("Sent test exception to Sentry.");
          }}
        >
          <ButtonText>Send test exception</ButtonText>
        </Button>
        {result ? <Text>{result}</Text> : null}
        </Box>
      </ScrollView>
    </Screen>
  );
}
