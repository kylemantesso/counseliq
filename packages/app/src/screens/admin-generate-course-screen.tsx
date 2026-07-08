import { Box, Text } from "@counseliq/ui";

/**
 * Native stub — course generation (uploads, run orchestration) is a
 * web-only admin surface. Metro bundles this file; Next resolves the
 * .web.tsx sibling.
 */
export function AdminGenerateCourseScreen() {
  return (
    <Box className="flex-1 items-center justify-center p-8">
      <Text className="text-muted-foreground">
        Course generation is web-only. Open /admin/generate in the web app.
      </Text>
    </Box>
  );
}
