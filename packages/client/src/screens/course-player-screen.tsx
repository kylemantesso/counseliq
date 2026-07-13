"use client";

import { useQuery } from "convex/react";
import { useParams } from "solito/navigation";
import { Box, Heading, Spinner, Text } from "@counseliq/ui";
import { Screen } from "../components/screen";
import { api } from "../db/api";
import { RenderedCoursePlayer } from "../components/rendered-course-player";
import type { Id } from "../../../../convex/_generated/dataModel";

export function CoursePlayerScreen() {
  const params = useParams<{ id: string }>();
  const courseId = params?.id as Id<"courses"> | undefined;
  const data = useQuery(
    api.publicCourses.getPublishedCourse,
    courseId ? { courseId } : "skip"
  );

  return (
    <Screen className="flex-1 bg-background" edges={[]}>
      {data === undefined ? (
        <Box className="flex-1 items-center justify-center bg-black">
          <Spinner />
        </Box>
      ) : data === null ? (
        <Box className="flex-1 items-center justify-center bg-background p-6">
          <Heading size="xl" className="text-center">Course not found</Heading>
          <Text className="mt-2 text-center text-muted-foreground">
            This course is not published or is unavailable.
          </Text>
        </Box>
      ) : (
        <RenderedCoursePlayer data={data} />
      )}
    </Screen>
  );
}
