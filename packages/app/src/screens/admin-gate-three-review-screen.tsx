import { Box, Text } from "@counseliq/ui";

/**
 * Native stub — the step-3 studio drives the DOM-only course player
 * (@counseliq/cards + HTMLAudioElement). Metro bundles this file; Next
 * resolves the .web.tsx sibling.
 */
export function AdminGateThreeReviewScreen() {
  return (
    <Box className="flex-1 items-center justify-center p-8">
      <Text className="text-muted-foreground">
        Step 3 preview studio is web-only. Open this run in the web app.
      </Text>
    </Box>
  );
}
