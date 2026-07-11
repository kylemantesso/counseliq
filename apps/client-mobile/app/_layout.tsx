import "@counseliq/ui/global.native.css";
import * as WebBrowser from "expo-web-browser";
import { Stack, useRouter } from "expo-router";
import { View } from "react-native";
import { ClerkLoaded, ClerkProvider, useClerk } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { resourceCache } from "@clerk/clerk-expo/resource-cache";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/clerk-expo";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { UIProvider } from "@counseliq/ui";
import {
  AppErrorBoundary,
  AuthProvider,
  ForceUpgradeGate,
  OtaUpdateRuntime,
  PostHogRuntime,
  PushNotificationsRuntime,
} from "@counseliq/client";
import { convex } from "../lib/convex";
import { useCallback } from "react";

WebBrowser.maybeCompleteAuthSession();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in apps/client-mobile/.env"
  );
}

function AuthProviderBridge({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { signOut } = useClerk();

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, [signOut]);

  return (
    <AuthProvider
      signOut={handleSignOut}
      onLogout={() => router.replace("/login")}
    >
      {children}
    </AuthProvider>
  );
}

function RootStack() {
  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { flex: 1, backgroundColor: "#f5f5f0" },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="home" />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      __experimental_resourceCache={resourceCache}
    >
      <ClerkLoaded>
        <UIProvider>
          <SafeAreaProvider>
            <AppErrorBoundary>
              <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
                <ForceUpgradeGate>
                  <AuthProviderBridge>
                    <PostHogRuntime>
                      <OtaUpdateRuntime />
                      <PushNotificationsRuntime />
                      <RootStack />
                    </PostHogRuntime>
                  </AuthProviderBridge>
                </ForceUpgradeGate>
              </ConvexProviderWithClerk>
            </AppErrorBoundary>
          </SafeAreaProvider>
        </UIProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
