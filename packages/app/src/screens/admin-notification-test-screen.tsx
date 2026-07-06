"use client";

import { useState } from "react";
import { Platform } from "react-native";
import { ScrollView } from "@counseliq/ui";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  Text,
} from "@counseliq/ui";
import { AdminGuard } from "../components/admin-guard";
import { Screen } from "../components/screen";
import { api } from "../db/api";

export function AdminNotificationTestScreen() {
  return (
    <AdminGuard>
      <AdminNotificationTestContent />
    </AdminGuard>
  );
}

function AdminNotificationTestContent() {
  const router = useRouter();
  const page = useQuery(api.adminNotifications.getNotificationTestPage);
  const sendTestPush = useMutation(api.adminNotifications.sendTestPush);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    setLoading(true);
    setResult("");
    try {
      const delivery = await sendTestPush({});
      setResult(`Queued delivery ${delivery.deliveryId}`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Send failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center">
        <Heading size="md">Test push</Heading>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <ButtonText>Back</ButtonText>
        </Button>
      </Box>
      <ScrollView className="flex-1 w-full">
        <Box className="flex-col gap-4 p-6">
        {!page ? (
          <Text>Loading...</Text>
        ) : (
          <>
            <Text className="text-muted-foreground">
              {Platform.OS === "web"
                ? "Push notifications are mobile-only."
                : "Send a test push via the notification outbox."}
            </Text>
            <Text>Registered tokens: {page.tokens.length}</Text>
            <Button
              variant="default"
              isDisabled={loading || Platform.OS === "web"}
              onPress={handleSend}
            >
              <ButtonText>{loading ? "Sending..." : "Send test push"}</ButtonText>
            </Button>
            {result ? <Text>{result}</Text> : null}
          </>
        )}
        </Box>
      </ScrollView>
    </Screen>
  );
}
