"use client";

import { ScrollView } from "@app-template/ui";
import { useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  Text,
} from "@app-template/ui";
import { AuthGuard } from "../components/auth-guard";
import { Screen } from "../components/screen";
import { useAuth } from "../auth";

const STATS = [
  { label: "Total Users", value: "1,234", change: "+12%" },
  { label: "Revenue", value: "$12,345", change: "+8%" },
  { label: "Active Sessions", value: "567", change: "+23%" },
  { label: "Conversion", value: "3.2%", change: "+5%" },
];

export function DashboardScreen() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}

function DashboardContent() {
  const router = useRouter();
  const { user, logout } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="border-b border-border bg-card">
        <Box className="mx-auto w-full max-w-[1120px] flex-row flex-wrap items-center justify-between gap-3 px-6 py-4">
          <Box className="flex-row items-center gap-2">
            <Box className="h-7 w-7 items-center justify-center rounded-full bg-primary">
              <Text className="text-xs font-bold text-primary-foreground">Y</Text>
            </Box>
            <Text className="text-lg font-bold text-foreground">Dashboard</Text>
          </Box>
          <Box className="flex-row items-center gap-4">
            <Text className="text-sm text-muted-foreground">{user.email}</Text>
            <Button variant="outline" onPress={() => logout()}>
              <ButtonText>Sign Out</ButtonText>
            </Button>
          </Box>
        </Box>
      </Box>

      <ScrollView className="w-full flex-1 flex-col items-center">
        <Box className="w-full max-w-[1120px] flex-col gap-6 p-6">
        <Box className="mb-8 flex-col">
          <Text className="text-2xl font-bold text-foreground mb-2">
            Welcome back{user.name ? `, ${user.name}` : ""}
          </Text>
          <Text className="text-base text-muted-foreground leading-6">
            This is your authenticated dashboard. Only logged-in users can see
            this page.
          </Text>
        </Box>

        <Box className="flex-row flex-wrap gap-4 mb-8">
          {STATS.map((stat) => (
            <Box
              key={stat.label}
              className="flex-col bg-card p-5 rounded-2xl border border-border min-w-[200px] grow basis-[45%]"
            >
              <Text className="text-sm text-muted-foreground mb-2">{stat.label}</Text>
              <Box className="flex-row items-baseline gap-2">
                <Text className="text-3xl font-bold text-foreground">{stat.value}</Text>
                <Text className="text-sm text-success font-semibold">{stat.change}</Text>
              </Box>
            </Box>
          ))}
        </Box>

        <Box className="flex-col bg-card p-6 rounded-2xl border border-border">
          <Text className="text-lg font-semibold text-foreground mb-4">Quick Actions</Text>
          <Box className="flex-row flex-wrap gap-3">
            <Button variant="outline" onPress={() => router.push("/tasks")}>
              <ButtonText>View Tasks</ButtonText>
            </Button>
            {user.isAdmin ? (
              <Button variant="outline" onPress={() => router.push("/admin")}>
                <ButtonText>Admin</ButtonText>
              </Button>
            ) : null}
          </Box>
        </Box>
        </Box>
      </ScrollView>
    </Screen>
  );
}
