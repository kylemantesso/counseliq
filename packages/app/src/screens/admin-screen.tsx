"use client";

import { ScrollView } from "@counseliq/ui";
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
import { ADMIN_TOOLS } from "../components/admin/admin-tools";

export function AdminScreen() {
  return (
    <AdminGuard>
      <AdminContent />
    </AdminGuard>
  );
}

function AdminContent() {
  const router = useRouter();

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4">
        <Heading size="lg">Admin tools</Heading>
        <Text className="text-muted-foreground mt-1">
          Internal tools for testing integrations.
        </Text>
      </Box>

      <ScrollView className="flex-1 w-full">
        <Box className="flex-col gap-4 p-6">
        {ADMIN_TOOLS.map((tool) => (
          <Box
            key={tool.key}
            className="bg-card border border-border rounded-2xl p-4 gap-2"
          >
            <Text className="text-base font-semibold text-foreground">
              {tool.label}
            </Text>
            <Text className="text-muted-foreground">{tool.description}</Text>
            <Button
              variant="outline"
              size="sm"
              className="self-start mt-2"
              onPress={() => router.push(tool.href)}
            >
              <ButtonText>Open</ButtonText>
            </Button>
          </Box>
        ))}
        </Box>
      </ScrollView>
    </Screen>
  );
}
