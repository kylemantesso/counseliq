import { Box, Text } from "@counseliq/ui";

/**
 * Native stub — @counseliq/cards is a DOM-only package; the gallery (and the
 * course player it previews) are web-only surfaces. Metro bundles this file;
 * Next resolves the .web.tsx sibling.
 */
export function CardsGalleryScreen() {
  return (
    <Box className="flex-1 items-center justify-center p-8">
      <Text className="text-muted-foreground">
        The cards gallery is web-only. Open /ui/cards in the web app.
      </Text>
    </Box>
  );
}
