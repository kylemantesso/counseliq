import { Box, Text } from "@counseliq/ui";

/**
 * Native stub - model routing is currently web-only.
 */
export function AdminModelRoutingScreen() {
  return (
    <Box className="flex-1 items-center justify-center p-8">
      <Text className="text-muted-foreground">
        Model routing is web-only. Open /admin/model-routing in the web app.
      </Text>
    </Box>
  );
}
