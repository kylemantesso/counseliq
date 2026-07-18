"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  EmptyStateCard,
  MetricTile,
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

export function AdminScreen() {
  return (
    <AdminGuard>
      <AdminContent />
    </AdminGuard>
  );
}

function AdminContent() {
  const router = useRouter();
  const { selectedInstitution, selectedInstitutionId } = useSelectedInstitution();
  const resumeGeneration = useMutation(
    (api as any).pipeline.runs.adminResumeCourseGeneration
  );
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const runs = useQuery(
    api.pipeline.queries.adminListRuns,
    selectedInstitutionId ? { institutionId: selectedInstitutionId } : "skip"
  );
  const docs = useQuery(api.pipeline.queries.listSourceDocs, {});

  const loading = runs === undefined || docs === undefined;
  const docsForSelected = useMemo(() => {
    if (!selectedInstitutionId || !docs) return [];
    return docs.filter((doc) => doc.institutionId === selectedInstitutionId);
  }, [docs, selectedInstitutionId]);

  const blockedApprovals = useMemo(
    () =>
      (runs ?? []).filter((run) =>
        ["OUTLINE_REVIEW", "GATE_2_COURSE_REVIEW", "GATE_3_PREVIEW"].includes(
          run.state
        )
      ),
    [runs]
  );
  const publishReadyRuns = useMemo(
    () => (runs ?? []).filter((run) => run.state === "GATE_3_PREVIEW"),
    [runs]
  );
  const publishedRuns = useMemo(
    () => (runs ?? []).filter((run) => run.state === "PUBLISHED"),
    [runs]
  );

  const activeRun = blockedApprovals[0] ?? runs?.[0] ?? null;
  const nextAction = blockedApprovals[0]
    ? `review ${stateLabel(blockedApprovals[0].state)} on ${displayGenerationName(blockedApprovals[0])}`
    : "create a new course";

  const hasSetupGap = !selectedInstitutionId || docsForSelected.length === 0;

  return (
    <AdminWorkspaceFrame
      activeNav="home"
      title="What needs your attention"
      description={`${runs?.length ?? 0} course generations in production · next recommended action: ${nextAction}`}
      headerActions={
        <>
          <Button
            variant="outline"
            isDisabled={!activeRun}
            onPress={() => {
              if (!activeRun) return;
              const destination = routeForRunState(activeRun._id, activeRun.state);
              router.push(destination ?? `/admin/runs/${activeRun._id}`);
            }}
          >
            <ButtonText>Review approvals</ButtonText>
          </Button>
          <Button onPress={() => router.push("/admin/runs/new")}>
            <ButtonText>Create course</ButtonText>
          </Button>
        </>
      }
    >
      {loading ? (
        <SurfaceCard>
          <Text className="text-muted-foreground">Loading workspace…</Text>
        </SurfaceCard>
      ) : hasSetupGap ? (
        <Box className="gap-4">
          <EmptyStateCard
            title="Set up your first course generation"
            description="Complete setup before launching the first course generation."
          />
          <SurfaceCard title="Setup checklist">
            <ChecklistRow
              done={Boolean(selectedInstitutionId)}
              label="Institution created"
              helper={selectedInstitution?.name ?? "Create or select an institution"}
            />
            <ChecklistRow
              done={docsForSelected.length > 0}
              label="Upload source documents"
              helper={
                docsForSelected.length > 0
                  ? `${docsForSelected.length} documents ready`
                  : "Handbooks, unit guides, or policy PDFs"
              }
            />
            <Button className="self-start" onPress={() => router.push("/admin/runs/new") }>
              <ButtonText>Create your first course</ButtonText>
            </Button>
          </SurfaceCard>
        </Box>
      ) : (
        <ScrollView className="flex-1 w-full">
          <Box className="gap-4 pb-4">
            <Box className="flex-row flex-wrap gap-3">
              <Box className="min-w-[220px] flex-1">
                <MetricTile
                  label="Generations in progress"
                  value={String(runs?.length ?? 0)}
                  helper={`${blockedApprovals.length} waiting on your approval`}
                />
              </Box>
              <Box className="min-w-[220px] flex-1">
                <MetricTile
                  label="Blocked approvals"
                  value={String(blockedApprovals.length)}
                  helper={
                    blockedApprovals[0]
                      ? `${displayGenerationName(blockedApprovals[0])} · ${stateLabel(blockedApprovals[0].state)}`
                      : "No approvals waiting"
                  }
                />
              </Box>
              <Box className="min-w-[220px] flex-1">
                <MetricTile
                  label="Ready to publish"
                  value={String(publishReadyRuns.length)}
                  helper={
                    publishReadyRuns[0]
                      ? `${displayGenerationName(publishReadyRuns[0])} · Preview approval`
                      : "No generations ready"
                  }
                />
              </Box>
              <Box className="min-w-[220px] flex-1">
                <MetricTile
                  label="Last publish"
                  value={publishedRuns[0] ? shortDate(publishedRuns[0]._creationTime) : "—"}
                  helper={publishedRuns[0] ? displayGenerationName(publishedRuns[0]) : "No published courses"}
                />
              </Box>
            </Box>

            <SurfaceCard
              title="Continue where you left off"
              subtitle={
                activeRun
                  ? `${displayGenerationName(activeRun)} · ${selectedInstitution?.name ?? "Institution"} · started ${shortDate(
                      activeRun._creationTime
                    )}`
                  : "No active course generation"
              }
              actions={
                activeRun ? (
                  <Button
                    onPress={async () => {
                      const destination = routeForRunState(activeRun._id, activeRun.state);
                      if (destination) {
                        setResumeError(null);
                        router.push(destination);
                        return;
                      }

                      setResumeBusy(true);
                      setResumeError(null);
                      try {
                        const result = (await resumeGeneration({
                          runId: activeRun._id,
                        })) as { queued?: boolean };
                        if (!result?.queued) {
                          setResumeError(
                            "This course generation is waiting for approval and has no background stage to resume."
                          );
                          return;
                        }
                        router.push(`/admin/runs/${activeRun._id}`);
                      } catch (resumeError) {
                        setResumeError(
                          getUserFacingErrorMessage(
                            resumeError,
                            "Could not resume this course generation right now."
                          )
                        );
                      } finally {
                        setResumeBusy(false);
                      }
                    }}
                  >
                    <ButtonText>
                      {resumeBusy
                        ? "Resuming..."
                        : actionLabelForState(activeRun.state)}
                    </ButtonText>
                  </Button>
                ) : null
              }
            >
              <PipelineProgress currentState={activeRun?.state} />
              {resumeError ? (
                <Text className="text-sm text-destructive mt-1">{resumeError}</Text>
              ) : null}
            </SurfaceCard>

            <SurfaceCard
              title="Recent course generations"
              actions={
                <Button variant="outline" size="sm" onPress={() => router.push("/admin/runs") }>
                  <ButtonText>View all</ButtonText>
                </Button>
              }
            >
              <Box className="gap-0">
                {(runs ?? []).slice(0, 6).map((run) => (
                  <Box
                    key={run._id}
                    className="flex-row items-center gap-3 border-t border-border py-3 first:border-t-0"
                    >
                      <Box className="flex-1 min-w-[220px]">
                        <Text className="font-semibold">{displayGenerationName(run)}</Text>
                      </Box>
                    <Box className="w-48">
                      <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                        {selectedInstitution?.name ?? "Institution"}
                      </Text>
                    </Box>
                    <Box className="w-44">
                      <StatusBadge label={stateLabel(run.state)} tone={stateTone(run.state)} />
                    </Box>
                    <Box className="w-28">
                      <Text className="text-sm text-muted-foreground">{timeAgo(run._creationTime)}</Text>
                    </Box>
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() =>
                        router.push(
                          routeForRunState(run._id, run.state) ?? `/admin/runs/${run._id}`
                        )
                      }
                    >
                      <ButtonText>Open</ButtonText>
                    </Button>
                  </Box>
                ))}
              </Box>
            </SurfaceCard>
          </Box>
        </ScrollView>
      )}
    </AdminWorkspaceFrame>
  );
}

function ChecklistRow({
  done,
  label,
  helper,
}: {
  done: boolean;
  label: string;
  helper: string;
}) {
  return (
    <Box className="flex-row items-center justify-between gap-3 border border-border rounded-lg px-3 py-2">
      <Box>
        <Text className="font-semibold">{label}</Text>
        <Text className="text-xs text-muted-foreground">{helper}</Text>
      </Box>
      <StatusBadge label={done ? "Ready" : "Pending"} tone={done ? "success" : "warning"} />
    </Box>
  );
}

function PipelineProgress({ currentState }: { currentState?: string }) {
  const order = [
    ["INGEST", "INVENTORYING", "OUTLINING"],
    ["OUTLINE_REVIEW"],
    ["COMPILING", "COMPILED", "QA_RUNNING", "QA_FLAGGED", "QA_PASSED"],
    ["GATE_2_COURSE_REVIEW"],
    ["GENERATING_SCRIPT", "GENERATING_ASSETS", "GENERATING_AVATAR"],
    ["GATE_3_PREVIEW"],
    ["PUBLISHING", "PUBLISHED"],
  ] as const;
  const labels = [
    "Ingest",
    "Outline approval",
    "Compile",
    "Course approval",
    "Synthesis",
    "Preview approval",
    "Publish",
  ];

  const currentStep = Math.max(
    0,
    order.findIndex((states) => states.includes((currentState ?? "") as never))
  );

  return (
    <Box className="flex-row items-center gap-3 flex-wrap">
      {labels.map((label, index) => {
        const done = index < currentStep;
        const active = index === currentStep;
        return (
          <Box key={label} className="flex-row items-center gap-2">
            <Box
              className={`h-3.5 w-3.5 rounded-full border ${
                done
                  ? "bg-success border-success"
                  : active
                    ? "bg-accent border-accent"
                    : "bg-background border-border"
              }`}
            />
            <Text
              className={`text-xs ${done || active ? "text-foreground font-semibold" : "text-muted-foreground"}`}
            >
              {label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function stateLabel(state: string): string {
  if (state === "OUTLINE_REVIEW") return "outline approval";
  if (state === "GATE_2_COURSE_REVIEW") return "course approval";
  if (state === "GATE_3_PREVIEW") return "preview approval";
  if (state === "PUBLISHED") return "Published";
  if (state === "QA_FLAGGED") return "QA warnings";
  if (state === "GENERATING_ASSETS") return "Synthesis";
  if (state === "GENERATING_AVATAR") return "Avatar video generation";
  return state.replaceAll("_", " ").toLowerCase();
}

function stateTone(state: string): "neutral" | "success" | "warning" | "danger" {
  if (state === "PUBLISHED") return "success";
  if (state.includes("GATE")) return "warning";
  if (state === "FAILED") return "danger";
  return "neutral";
}

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

function timeAgo(timestamp: number): string {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

function routeForRunState(runId: Id<"runs">, state: string): string | null {
  if (state === "OUTLINE_REVIEW" || state === "OUTLINING") return `/admin/runs/${runId}/outline`;
  if (["GATE_2_COURSE_REVIEW", "COMPILED", "QA_RUNNING", "QA_PASSED", "QA_FLAGGED"].includes(state)) {
    return `/admin/runs/${runId}/gate-2`;
  }
  if (
    ["GATE_3_PREVIEW", "GENERATING_SCRIPT", "GENERATING_ASSETS", "GENERATING_AVATAR", "PUBLISHING", "PUBLISHED"].includes(
      state
    )
  ) {
    return `/admin/runs/${runId}/gate-3`;
  }
  return null;
}

function actionLabelForState(state: string): string {
  if (state === "OUTLINE_REVIEW") return "Open outline approval";
  if (state === "GATE_2_COURSE_REVIEW") return "Open course approval";
  if (state === "GATE_3_PREVIEW") return "Open preview approval";
  return `Resume ${stateLabel(state)}`;
}

function displayGenerationName(run: { _id: Id<"runs">; courseTitle: string | null }): string {
  const title = run.courseTitle?.trim();
  if (title) return title;
  return "Untitled course generation";
}
