import { Box, Text } from "@counseliq/ui";

/**
 * Native stub - institution management is currently web-only.
 */
export function AdminInstitutionsScreen() {
  return (
    <Box className="flex-1 items-center justify-center p-8">
      <Text className="text-muted-foreground">
        Institution management is web-only. Open /admin/institutions in the web app.
      </Text>
    </Box>
  );
}
