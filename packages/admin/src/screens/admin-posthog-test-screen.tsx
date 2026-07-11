"use client";

import { useState } from "react";
import { ScrollView } from "@counseliq/ui";
import { useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  Text,
} from "@counseliq/ui";
import { AnalyticsEvent } from "../analytics/events";
import { trackProductEvent } from "../analytics/track-product-event";
import { AdminGuard } from "../components/admin-guard";
import { Screen } from "../components/screen";
import { isPostHogConfigured } from "../analytics/initialize-posthog";

export function AdminPostHogTestScreen() {
  return (
    <AdminGuard>
      <AdminPostHogTestContent />
    </AdminGuard>
  );
}

function AdminPostHogTestContent() {
  const router = useRouter();
  const [result, setResult] = useState("");
  const configured = isPostHogConfigured();

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center">
        <Heading size="md">Test PostHog</Heading>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <ButtonText>Back</ButtonText>
        </Button>
      </Box>
      <ScrollView className="flex-1 w-full">
        <Box className="flex-col gap-4 p-6">
        <Text className="text-muted-foreground">
          {configured
            ? "PostHog project token is configured."
            : "PostHog is not configured — events are no-ops."}
        </Text>
        <Button
          variant="default"
          onPress={() => {
            trackProductEvent(AnalyticsEvent.ADMIN_POSTHOG_TEST, "admin", {
              source: "admin_posthog_test_screen",
            });
            setResult(configured ? "Sent test event." : "No-op (PostHog not configured).");
          }}
        >
          <ButtonText>Send test event</ButtonText>
        </Button>
        {result ? <Text>{result}</Text> : null}
        </Box>
      </ScrollView>
    </Screen>
  );
}
