import { Box, Text } from "@counseliq/ui";
import type { CoursePlayerProps } from "./course-player.web";

/**
 * Native stub — the course player is web-only (plain DOM + HTMLAudioElement).
 * The gate-3 studio is an admin surface; mobile reviewers use the web app.
 */
export function CoursePlayer(_props: CoursePlayerProps) {
  return (
    <Box className="p-6">
      <Text className="text-muted-foreground">
        The course player is available in the web admin app only.
      </Text>
    </Box>
  );
}
