"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "solito/link";
import { Box, Heading, Input, InputField, Pressable, ScrollView, Spinner, Text } from "@counseliq/ui";
import { Screen } from "../components/screen";
import { api } from "../db/api";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function CourseCatalogScreen() {
  const courses = useQuery(api.publicCourses.listPublishedCourses);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!courses || !needle) return courses ?? [];
    return courses.filter((course) =>
      `${course.title} ${course.institution.name}`.toLowerCase().includes(needle)
    );
  }, [courses, search]);
  const readyCount = (courses ?? []).filter((course) => course.playbackStatus === "ready").length;
  const totalUnits = (courses ?? []).reduce((sum, course) => sum + course.counts.units, 0);
  const readyUnits = (courses ?? []).reduce((sum, course) => sum + course.counts.readyUnits, 0);
  const overallPct = totalUnits > 0 ? Math.round((readyUnits / totalUnits) * 100) : 0;

  return (
    <Screen className="flex-1 bg-background" padding={{ top: 22, bottom: 0 }}>
      <ScrollView className="flex-1">
        <Box className="mx-auto w-full max-w-[980px] gap-6 px-5 pb-8 md:px-8">
          <Box className="flex-row items-start justify-between gap-4">
            <Box className="flex-1 gap-3">
              <Text className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                Prototype · Published courses
              </Text>
              <Heading className="text-[42px] leading-[44px] md:text-[56px] md:leading-[58px]">
                Good morning,
                {"\n"}Priya
              </Heading>
            </Box>
            <Box className="h-14 w-14 items-center justify-center rounded-full bg-foreground">
              <Text className="font-bold text-background">PK</Text>
            </Box>
          </Box>

          <Box className="gap-2 border-b border-border pb-6">
            <Box className="flex-row items-center justify-between">
              <Text className="text-muted-foreground">
                {readyCount} ready {readyCount === 1 ? "course" : "courses"} from published content
              </Text>
              <Text className="text-muted-foreground">{overallPct}%</Text>
            </Box>
            <Box className="h-1.5 overflow-hidden rounded-full bg-muted">
              <Box className="h-full rounded-full bg-primary" style={{ width: `${overallPct}%` }} />
            </Box>
          </Box>

          <Input className="rounded-2xl border-border bg-card">
            <InputField
              placeholder="Search courses & institutions"
              value={search}
              onChangeText={setSearch}
              className="text-foreground"
            />
          </Input>

          <Box className="flex-row items-center justify-between">
            <Text className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Your courses</Text>
            <Text className="text-xs tabular-nums text-muted-foreground">
              {(courses ?? []).length.toString().padStart(2, "0")}
            </Text>
          </Box>

          {courses === undefined ? (
            <Box className="items-center justify-center rounded-3xl border border-border bg-card p-10">
              <Spinner />
            </Box>
          ) : filtered.length === 0 ? (
            <Box className="items-center justify-center rounded-3xl border border-border bg-card p-10">
              <Heading size="lg">No published courses found</Heading>
              <Text className="mt-2 text-center text-muted-foreground">
                Publish a course and let its videos render to see it here.
              </Text>
            </Box>
          ) : (
            <Box className="gap-4">
              {filtered.map((course) => {
                const pct = course.counts.units > 0
                  ? Math.round((course.counts.readyUnits / course.counts.units) * 100)
                  : 0;
                return (
                  <Link key={course.courseId} href={`/courses/${course.courseId}`}>
                    <Pressable>
                      <Box className="gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm">
                        <Box className="flex-row items-center gap-4">
                          <Box className="h-14 w-14 items-center justify-center rounded-2xl bg-foreground">
                            <Text className="font-bold text-background">{initials(course.institution.name)}</Text>
                          </Box>
                          <Box className="min-w-0 flex-1">
                            <Text className="text-xs uppercase tracking-[0.2em] text-muted-foreground" numberOfLines={1}>
                              {course.institution.name}
                            </Text>
                            <Heading size="xl" numberOfLines={2}>{course.title}</Heading>
                          </Box>
                          <Box className="h-10 w-10 items-center justify-center rounded-full bg-primary">
                            <Text className="font-bold text-primary-foreground">→</Text>
                          </Box>
                        </Box>
                        <Box className="gap-2">
                          <Box className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <Box className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                          </Box>
                          <Text className="text-sm text-muted-foreground">
                            {pct}% · {course.counts.modules} modules · {course.counts.readyUnits}/{course.counts.units} videos ready · {course.playbackStatus}
                          </Text>
                        </Box>
                      </Box>
                    </Pressable>
                  </Link>
                );
              })}
            </Box>
          )}
        </Box>
      </ScrollView>
    </Screen>
  );
}
