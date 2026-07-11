import { Box, Text } from "@counseliq/ui";

/**
 * Native stub — the asset library (uploads, rights declaration) is a
 * web-only admin surface. Metro bundles this file; Next resolves the
 * .web.tsx sibling.
 */
export function AdminAssetLibraryScreen() {
  return (
    <Box className="flex-1 items-center justify-center p-8">
      <Text className="text-muted-foreground">
        The asset library is web-only. Open /admin/assets in the web app.
      </Text>
    </Box>
  );
}
