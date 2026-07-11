import { Box, Text } from "@counseliq/ui";

/**
 * Native stub - institution card previews use the DOM-only card renderer.
 */
export function AdminInstitutionCardPreviewScreen() {
  return (
    <Box className="flex-1 items-center justify-center p-8">
      <Text className="text-muted-foreground">
        Institution card previews are web-only. Open /admin/institution-card-preview in the web app.
      </Text>
    </Box>
  );
}
