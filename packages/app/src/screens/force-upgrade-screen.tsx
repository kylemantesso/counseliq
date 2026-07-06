"use client";

import { Platform } from "react-native";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  Text,
} from "@app-template/ui";
import { Screen } from "../components/screen";
import { APP_VERSION_NUMBER } from "../version/app-version";
import { openStoreListing } from "../version/store-links";

const STORE_NAME =
  Platform.OS === "ios" ? "the App Store" : "Google Play";

export function ForceUpgradeScreen() {
  return (
    <Screen className="flex-1 bg-background">
      <Box className="flex-1 justify-center px-6 gap-6">
        <Box className="gap-2">
          <Text className="text-xs uppercase tracking-wider text-primary font-semibold mb-2">
            Update required
          </Text>
          <Heading size="2xl" className="mb-3">
            Time to update
          </Heading>
          <Text className="text-muted-foreground text-base">
            This version is no longer supported. Update from {STORE_NAME} to continue.
          </Text>
        </Box>
        <Button variant="default" size="lg" onPress={openStoreListing}>
          <ButtonText>Update app</ButtonText>
        </Button>
        <Text className="text-muted-foreground text-sm">
          Installed v{APP_VERSION_NUMBER}
        </Text>
      </Box>
    </Screen>
  );
}
