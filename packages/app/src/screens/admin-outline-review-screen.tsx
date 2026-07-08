import { Box, Text } from "@counseliq/ui";

/**
 * Native stub — outline review (structured editing) is a web-only admin
 * surface. Metro bundles this file; Next resolves the .web.tsx sibling.
 */
export function AdminOutlineReviewScreen() {
  return (
    <Box className="flex-1 items-center justify-center p-8">
      <Text className="text-muted-foreground">
        Outline review is web-only. Open /admin/runs/[id]/outline in the web app.
      </Text>
    </Box>
  );
}
