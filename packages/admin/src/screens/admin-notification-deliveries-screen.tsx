"use client";

import { ScrollView } from "@counseliq/ui";
import { useQuery } from "convex/react";
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

export function AdminNotificationDeliveriesScreen() {
  return (
    <AdminGuard>
      <AdminNotificationDeliveriesContent />
    </AdminGuard>
  );
}

function AdminNotificationDeliveriesContent() {
  const router = useRouter();
  const deliveries = useQuery(api.adminNotifications.listRecentDeliveries);

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center">
        <Heading size="md">Notification log</Heading>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <ButtonText>Back</ButtonText>
        </Button>
      </Box>
      <ScrollView className="flex-1 w-full">
        <Box className="flex-col gap-3 p-6">
        {deliveries === undefined ? (
          <Text>Loading...</Text>
        ) : deliveries.length === 0 ? (
          <Text className="text-muted-foreground">No deliveries yet.</Text>
        ) : (
          deliveries.map((row) => (
            <Box
              key={row._id}
              className="bg-card border border-border rounded-xl p-4 gap-1"
            >
              <Text className="font-semibold">
                {row.type} · {row.channel} · {row.status}
              </Text>
              <Text className="text-muted-foreground text-sm">
                {row.lastError ?? "No error"}
              </Text>
            </Box>
          ))
        )}
        </Box>
      </ScrollView>
    </Screen>
  );
}
