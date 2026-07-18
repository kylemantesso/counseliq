"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  EmptyStateCard,
  Pressable,
  ScrollView,
  StatusBadge,
  SurfaceCard,
  Text,
} from "@counseliq/ui";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { useSelectedInstitution } from "../components/admin/use-selected-institution";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

type QueueFilter = "all" | "progress" | "attention" | "published";

type RunPhase = {
  label: string;
  activity: string;
  progress: number;
};

const ATTENTION_STATES = new Set([
  "GATE_1_KNOWLEDGE_REVIEW",
  "GATE_2_QUIZ_REVIEW",
  "OUTLINE_REVIEW",
  "GATE_2_COURSE_REVIEW",
  "GATE_3_PREVIEW",
]);

const RUN_PHASES: Record<string, RunPhase> = {
  UPLOADED: { label: "Prepare sources", activity: "Preparing source documents", progress: 5 },
  CONVERTING: { label: "Convert sources", activity: "Converting source documents", progress: 12 },
  CONVERTED: { label: "Sources converted", activity: "Preparing source extraction", progress: 18 },
  EXTRACTING: { label: "Extract sources", activity: "Extracting source content", progress: 24 },
  EXTRACTED: { label: "Sources ready", activity: "Preparing the course outline", progress: 30 },
  GATE_1_KNOWLEDGE_REVIEW: {
    label: "Source review",
    activity: "Source knowledge is ready for approval",
    progress: 30,
  },
  OUTLINING: { label: "Draft outline", activity: "Drafting the course outline", progress: 38 },
  OUTLINE_REVIEW: {
    label: "Outline approval",
    activity: "Course outline is ready for approval",
    progress: 45,
  },
  COMPILING: { label: "Author content", activity: "Authoring course content", progress: 58 },
  COMPILED: { label: "Course assembled", activity: "Preparing quality checks", progress: 66 },
  QA_RUNNING: { label: "Quality checks", activity: "Checking course quality", progress: 70 },
  QA_PASSED: { label: "Quality passed", activity: "Preparing course review", progress: 74 },
  QA_FLAGGED: { label: "Quality findings", activity: "Reviewing quality findings", progress: 74 },
  GATE_2_QUIZ_REVIEW: {
    label: "Quiz approval",
    activity: "Quiz content is ready for approval",
    progress: 74,
  },
  GATE_2_COURSE_REVIEW: {
    label: "Course approval",
    activity: "Course draft is ready for approval",
    progress: 76,
  },
  GENERATING_SCRIPT: {
    label: "Prepare narration",
    activity: "Preparing narration scripts",
    progress: 82,
  },
  GENERATING_ASSETS: {
    label: "Generate media",
    activity: "Generating audio and media",
    progress: 88,
  },
  GENERATING_AVATAR: {
    label: "Generate avatar video",
    activity: "Generating avatar videos",
    progress: 90,
  },
  GATE_3_PREVIEW: {
    label: "Preview approval",
    activity: "Course preview is ready for approval",
    progress: 92,
  },
  PUBLISHING: { label: "Publish course", activity: "Publishing the course", progress: 97 },
  PUBLISHED: { label: "Published", activity: "Course is published", progress: 100 },
};

export function AdminCourseQueueScreen() {
  return (
    <AdminGuard>
      <AdminCourseQueueContent />
    </AdminGuard>
  );
}

function AdminCourseQueueContent() {
  const router = useRouter();
  const { institutions, selectedInstitution, selectedInstitutionId } = useSelectedInstitution();
  const deleteRun = useMutation((api as any).pipeline.runs.adminDeleteRun);
  const [activeFilter, setActiveFilter] = useState<QueueFilter>("all");
  const [confirmingRunId, setConfirmingRunId] = useState<Id<"runs"> | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<Id<"runs"> | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const runs = useQuery(
    api.pipeline.queries.adminListRuns,
    selectedInstitutionId ? { institutionId: selectedInstitutionId } : "skip"
  );

  const counts = useMemo(() => {
    const allRuns = runs ?? [];
    return {
      all: allRuns.length,
      progress: allRuns.filter((run) => queueCategory(run.state) === "progress").length,
      attention: allRuns.filter((run) => queueCategory(run.state) === "attention").length,
      published: allRuns.filter((run) => queueCategory(run.state) === "published").length,
    };
  }, [runs]);

  const visibleRuns = useMemo(() => {
    if (!runs || activeFilter === "all") return runs ?? [];
    return runs.filter((run) => queueCategory(run.state) === activeFilter);
  }, [activeFilter, runs]);

  const onDeleteRun = async (runId: Id<"runs">) => {
    setDeleteError(null);
    setDeletingRunId(runId);
    try {
      await deleteRun({ runId });
      setConfirmingRunId(null);
    } catch (error) {
      setDeleteError(
        getUserFacingErrorMessage(error, "Could not delete this course generation. Try again.")
      );
    } finally {
      setDeletingRunId(null);
    }
  };

  return (
    <AdminWorkspaceFrame
      activeNav="runs"
      title="Course queue"
      description={
        selectedInstitutionId
          ? `${runs?.length ?? 0} course generations for ${selectedInstitution?.name ?? "this institution"}.`
          : "Select an institution to view active and completed course generations."
      }
      headerActions={
        <Button
          onPress={() => router.push("/admin/runs/new")}
          accessibilityLabel="Create a new course"
        >
          <ButtonText>+ Create course</ButtonText>
        </Button>
      }
    >
      {institutions === undefined ? (
        <SurfaceCard>
          <Text className="text-muted-foreground">Loading institutions...</Text>
        </SurfaceCard>
      ) : institutions.length === 0 ? (
        <EmptyStateCard
          title="No institutions available"
          description="Create an institution before starting a course generation."
          ctaLabel="Manage institutions"
          onPress={() => router.push("/admin/institutions")}
        />
      ) : !selectedInstitutionId ? (
        <EmptyStateCard
          title="Select an institution"
          description="Choose an institution from the top bar to view its course queue."
        />
      ) : runs === undefined ? (
        <SurfaceCard>
          <Text className="text-muted-foreground">Loading course queue...</Text>
        </SurfaceCard>
      ) : runs.length === 0 ? (
        <EmptyStateCard
          title="No course generations yet"
          description="Start a new generation to populate this queue."
          ctaLabel="Create course"
          onPress={() => router.push("/admin/runs/new")}
        />
      ) : (
        <ScrollView className="flex-1 w-full">
          <Box className="gap-4 pb-4">
            <Box className="flex-row flex-wrap gap-2" accessibilityRole="tablist">
              <FilterPill
                label="All"
                count={counts.all}
                active={activeFilter === "all"}
                onPress={() => setActiveFilter("all")}
              />
              <FilterPill
                label="In progress"
                count={counts.progress}
                active={activeFilter === "progress"}
                onPress={() => setActiveFilter("progress")}
              />
              <FilterPill
                label="Needs attention"
                count={counts.attention}
                active={activeFilter === "attention"}
                onPress={() => setActiveFilter("attention")}
              />
              <FilterPill
                label="Published"
                count={counts.published}
                active={activeFilter === "published"}
                onPress={() => setActiveFilter("published")}
              />
            </Box>

            {deleteError ? (
              <Box className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3">
                <Text className="text-sm text-destructive">{deleteError}</Text>
              </Box>
            ) : null}

            {visibleRuns.length === 0 ? (
              <SurfaceCard>
                <Text className="text-muted-foreground">
                  No course generations match this filter.
                </Text>
              </SurfaceCard>
            ) : (
              <Box className="overflow-hidden rounded-[14px] border border-border bg-card">
                <Box className="hidden xl:flex flex-row items-center gap-4 border-b border-border bg-background px-5 py-3">
                  <TableHeading className="flex-1 min-w-[220px]">Course</TableHeading>
                  <TableHeading className="w-48">Status</TableHeading>
                  <TableHeading className="w-16">Sources</TableHeading>
                  <TableHeading className="w-28">Started</TableHeading>
                  <Box className="w-72" />
                </Box>

                {visibleRuns.map((run) => {
                  const presentation = runPresentation(run.state, run.failedFromState);
                  const runName = displayGenerationName(run);
                  const approvalRoute = approvalRouteForRunState(run._id, run.state);
                  return (
                    <Box
                      key={run._id}
                      className={`gap-4 border-b border-border px-4 py-4 last:border-b-0 xl:flex-row xl:items-center xl:px-5 ${
                        run.state === "FAILED" ? "bg-destructive/10" : ""
                      }`}
                    >
                      <Box className="min-w-0 flex-1 xl:min-w-[220px]">
                        <Text className="text-sm font-semibold text-foreground" numberOfLines={2}>
                          {runName}
                        </Text>
                        <Text className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {presentation.activity}
                        </Text>
                      </Box>

                      <Box className="gap-2 xl:w-48">
                        <Text className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground xl:hidden">
                          Status
                        </Text>
                        {presentation.category === "progress" ? (
                          <Box className="gap-2">
                            <Box className="flex-row items-center gap-1.5">
                              <Box className="h-1.5 w-1.5 rounded-full bg-primary" />
                              <Text className="text-xs font-semibold text-secondary-foreground">
                                In progress · {presentation.phase.label}
                              </Text>
                            </Box>
                            <Box
                              className="h-1.5 w-full overflow-hidden rounded-full bg-border"
                              accessibilityRole="progressbar"
                              accessibilityLabel={`${runName} generation progress`}
                              accessibilityValue={{
                                min: 0,
                                max: 100,
                                now: presentation.phase.progress,
                              }}
                            >
                              <Box
                                className="h-1.5 rounded-full bg-primary"
                                style={{ width: `${presentation.phase.progress}%` }}
                              />
                            </Box>
                          </Box>
                        ) : (
                          <StatusBadge
                            label={
                              presentation.category === "published"
                                ? "Published"
                                : "Needs attention"
                            }
                            tone={run.state === "FAILED" ? "danger" : presentation.category === "published" ? "success" : "warning"}
                          />
                        )}
                      </Box>

                      <QueueDatum label="Sources" className="xl:w-16">
                        {`${run.sourceCount} ${run.sourceCount === 1 ? "doc" : "docs"}`}
                      </QueueDatum>
                      <QueueDatum label="Started" className="xl:w-28">
                        {startedAt(run._creationTime)}
                      </QueueDatum>

                      <Box className="flex-row flex-wrap items-center gap-2 xl:w-72 xl:justify-end">
                        {run.state === "FAILED" ? (
                          <Button
                            size="sm"
                            onPress={() => router.push(`/admin/runs/${run._id}`)}
                            isDisabled={deletingRunId === run._id}
                            accessibilityLabel={`Resume ${runName}`}
                          >
                            <ButtonText>Resume</ButtonText>
                          </Button>
                        ) : null}
                        {approvalRoute ? (
                          <Button
                            size="sm"
                            onPress={() => router.push(approvalRoute)}
                            isDisabled={deletingRunId === run._id}
                            accessibilityLabel={`Review and approve ${runName}`}
                          >
                            <ButtonText>Review & approve</ButtonText>
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          onPress={() => router.push(`/admin/runs/${run._id}`)}
                          isDisabled={deletingRunId === run._id}
                          accessibilityLabel={`Open ${runName}`}
                        >
                          <ButtonText>Open</ButtonText>
                        </Button>
                        {confirmingRunId === run._id ? (
                          <Box className="flex-row flex-wrap items-center gap-1">
                            <Text className="px-1 text-xs text-muted-foreground">Delete?</Text>
                            <Button
                              size="sm"
                              variant="ghost"
                              onPress={() => setConfirmingRunId(null)}
                              isDisabled={deletingRunId === run._id}
                              accessibilityLabel={`Cancel deleting ${runName}`}
                            >
                              <ButtonText>Cancel</ButtonText>
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onPress={() => void onDeleteRun(run._id)}
                              isDisabled={deletingRunId !== null}
                              accessibilityLabel={`Confirm deleting ${runName}`}
                            >
                              <ButtonText>
                                {deletingRunId === run._id ? "Deleting..." : "Confirm"}
                              </ButtonText>
                            </Button>
                          </Box>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onPress={() => {
                              setDeleteError(null);
                              setConfirmingRunId(run._id);
                            }}
                            isDisabled={deletingRunId !== null}
                            accessibilityLabel={`Delete ${runName}`}
                          >
                            <ButtonText className="text-muted-foreground">Delete</ButtonText>
                          </Button>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        </ScrollView>
      )}
    </AdminWorkspaceFrame>
  );
}

function FilterPill({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={`rounded-full border px-3.5 py-2 ${
        active ? "border-primary bg-primary" : "border-border bg-card"
      }`}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${count} course generations`}
    >
      <Text
        className={`text-xs font-semibold ${
          active ? "text-primary-foreground" : "text-secondary-foreground"
        }`}
      >
        {label} · {count}
      </Text>
    </Pressable>
  );
}

function TableHeading({ children, className }: { children: string; className: string }) {
  return (
    <Text
      className={`text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground ${className}`}
    >
      {children}
    </Text>
  );
}

function QueueDatum({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: string;
}) {
  return (
    <Box className={`flex-row items-center gap-2 xl:block ${className}`}>
      <Text className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground xl:hidden">
        {label}
      </Text>
      <Text className="text-xs text-secondary-foreground">{children}</Text>
    </Box>
  );
}

function queueCategory(state: string): Exclude<QueueFilter, "all"> {
  if (state === "PUBLISHED") return "published";
  if (state === "FAILED" || ATTENTION_STATES.has(state)) return "attention";
  return "progress";
}

function runPresentation(state: string, failedFromState: string | null) {
  const phaseState = state === "FAILED" ? failedFromState : state;
  const phase =
    (phaseState ? RUN_PHASES[phaseState] : undefined) ?? {
      label: "Process course",
      activity: "Processing the course generation",
      progress: 5,
    };
  const category = queueCategory(state);

  return {
    category,
    phase,
    activity:
      state === "FAILED"
        ? `Stopped while ${lowercaseFirst(phase.activity)}`
        : phase.activity,
  };
}

function lowercaseFirst(value: string): string {
  return value.length > 0 ? value[0]!.toLowerCase() + value.slice(1) : value;
}

function startedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  const time = date.toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day}, ${time}`;
}

function approvalRouteForRunState(runId: Id<"runs">, state: string): string | null {
  if (state === "OUTLINE_REVIEW") return `/admin/runs/${runId}/outline`;
  if (state === "GATE_2_COURSE_REVIEW") return `/admin/runs/${runId}/gate-2`;
  if (state === "GATE_3_PREVIEW") return `/admin/runs/${runId}/gate-3`;
  return null;
}

function displayGenerationName(run: { _id: Id<"runs">; courseTitle: string | null }): string {
  const title = run.courseTitle?.trim();
  if (title) return title;
  return "Untitled course generation";
}
