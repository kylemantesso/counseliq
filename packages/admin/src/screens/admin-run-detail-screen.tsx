"use client";

import React, { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Link } from "solito/link";
import { useParams, useRouter } from "solito/navigation";
import { Platform } from "react-native";
import {
  Box,
  Button,
  ButtonText,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  Pressable,
  ScrollView,
  StatusBadge,
  SurfaceCard,
  Text,
} from "@counseliq/ui";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";
import {
  formatModuleNumberLabel,
  formatUnitPositionLabel,
  humanizeGeneratedUnitKeyText,
  parseGeneratedModuleNumber,
  parseGeneratedUnitPosition,
} from "../format/unit-labels";

type CompileUnitProgressLog = {
  unitId: string;
  label: string;
  status: "ok" | "error";
  warningCount: number;
  createdAt: number;
  cause?: string;
};

type RunCompileProgress = {
  runState: string;
  totalUnits: number | null;
  processedUnits: number;
  completedUnits: number;
  failedUnits: number;
  progressPercent: number | null;
  etaMs: number | null;
  compileStartedAt: number | null;
  lastUnitAt: number | null;
  recentUnits: CompileUnitProgressLog[];
};

type RunRenderStatus = {
  summary: {
    total: number;
    queued: number;
    dispatched: number;
    rendering: number;
    succeeded: number;
    failed: number;
    cancelled: number;
  };
  jobs: Array<{
    _id: Id<"renderJobs">;
    unitId: string;
    moduleId: string;
    unitIndex: number;
    status: string;
    attempts: number;
    maxAttempts: number;
    rendererVersion: string | null;
    output: {
      objectKey: string;
      sizeBytes: number;
      durationMs: number;
      width: number;
      height: number;
      fps: number;
      variants?: RenderedVideoVariant[];
    } | null;
    error: { code: string; message: string; retryable: boolean } | null;
  }>;
};

type RenderedVideoVariant = {
  label: string;
  objectKey: string;
  sizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
};

type RenderJob = RunRenderStatus["jobs"][number];

type RenderUnitMeta = {
  moduleLabel: string;
  moduleKey: string;
  moduleNumber: number | null;
  unitLabel: string;
  unitKey: string;
  unitNumber: number | null;
};

type PreviewVideo = {
  jobId: Id<"renderJobs">;
  objectKey: string;
  title: string;
  subtitle: string;
  meta: RenderUnitMeta;
  output: NonNullable<RenderJob["output"]>;
};

function renderedVideoVariants(output: NonNullable<RenderJob["output"]>): RenderedVideoVariant[] {
  return output.variants && output.variants.length > 0
    ? output.variants
    : [
        {
          label: "Primary",
          objectKey: output.objectKey,
          sizeBytes: output.sizeBytes,
          durationMs: output.durationMs,
          width: output.width,
          height: output.height,
          fps: output.fps,
        },
      ];
}

function selectedRenderedVideoVariant(video: PreviewVideo): RenderedVideoVariant {
  return (
    renderedVideoVariants(video.output).find(
      (variant) => variant.objectKey === video.objectKey
    ) ?? {
      label: "Primary",
      objectKey: video.objectKey,
      sizeBytes: video.output.sizeBytes,
      durationMs: video.output.durationMs,
      width: video.output.width,
      height: video.output.height,
      fps: video.output.fps,
    }
  );
}

function downloadFile(url: string, filename: string) {
  if (Platform.OS !== "web") return;
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function videoFilename(title: string, width: number, height: number) {
  const stem = `${title}-${width}x${height}`
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem || "rendered-video"}.mp4`;
}

type RunMediaSelection = {
  explicitSelection: boolean;
  counts: { selected: number; cleared: number; needsRights: number };
  assets: Array<{
    _id: Id<"assets">;
    kind: string;
    caption: string | null;
    rights: string;
    identifiablePeople: boolean;
    peopleConsentConfirmed: boolean;
    tagged: boolean;
    cleared: boolean;
    needsRights: boolean;
  }>;
};

type RunCourseRows = {
  course: Doc<"courses">;
  units: Doc<"microUnits">[];
  questions: Doc<"questions">[];
} | null;

type CourseMetricSummary = {
  modules: number | null;
  units: number | null;
  questions: number | null;
};

type RunEvent = Doc<"runEvents">;

type Phase = {
  label: string;
  shortLabel: string;
  states: string[];
  substeps: string[];
  approvalIndex?: number;
};

const PHASES: Phase[] = [
  {
    label: "Sources ready",
    shortLabel: "Sources ready",
    states: [
      "UPLOADED",
      "CONVERTING",
      "CONVERTED",
      "EXTRACTING",
      "EXTRACTED",
      "GATE_1_KNOWLEDGE_REVIEW",
    ],
    substeps: ["Upload", "Convert", "Review facts"],
    approvalIndex: 2,
  },
  {
    label: "Draft outline",
    shortLabel: "Draft outline",
    states: ["OUTLINING", "OUTLINE_REVIEW"],
    substeps: ["Generate outline", "Your approval"],
    approvalIndex: 1,
  },
  {
    label: "Build course",
    shortLabel: "Build course",
    states: [
      "COMPILING",
      "COMPILED",
      "QA_RUNNING",
      "QA_PASSED",
      "QA_FLAGGED",
      "GATE_2_COURSE_REVIEW",
      "GATE_2_QUIZ_REVIEW",
    ],
    substeps: ["Write narration & cards", "Quality checks", "Your approval"],
    approvalIndex: 2,
  },
  {
    label: "Create media & preview",
    shortLabel: "Media & preview",
    states: ["GENERATING_SCRIPT", "GENERATING_ASSETS", "GATE_3_PREVIEW"],
    substeps: ["Generate voice", "Create visuals", "Preview approval"],
    approvalIndex: 2,
  },
  {
    label: "Publish",
    shortLabel: "Publish",
    states: ["PUBLISHING", "PUBLISHED"],
    substeps: ["Publish course", "Render outputs"],
  },
];

const GATE_STATES = new Set([
  "GATE_1_KNOWLEDGE_REVIEW",
  "OUTLINE_REVIEW",
  "GATE_2_COURSE_REVIEW",
  "GATE_2_QUIZ_REVIEW",
  "GATE_3_PREVIEW",
]);

export function AdminRunDetailScreen() {
  return (
    <AdminGuard>
      <AdminRunDetailContent />
    </AdminGuard>
  );
}

function AdminRunDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const runId = params?.id as Id<"runs"> | undefined;
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [showFullLogs, setShowFullLogs] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [retryingRenderJobId, setRetryingRenderJobId] = useState<string | null>(null);
  const [rerenderingRenderJobId, setRerenderingRenderJobId] = useState<string | null>(null);
  const [restartingRenderJobId, setRestartingRenderJobId] = useState<string | null>(null);
  const [cancellingRenderJobId, setCancellingRenderJobId] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<PreviewVideo | null>(null);
  const [videoUrls, setVideoUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const [presigningVideoKey, setPresigningVideoKey] = useState<string | null>(null);
  const [videoPreviewError, setVideoPreviewError] = useState<string | null>(null);
  const [downloadingVideoKey, setDownloadingVideoKey] = useState<string | null>(null);
  const [videoDownloadError, setVideoDownloadError] = useState<string | null>(null);

  const presignBatch = useAction(api.pipeline.objectStore.adminPresignGetBatch);
  const presignDownloadBatch = useAction(
    api.pipeline.objectStore.adminPresignDownloadBatch
  );
  const resumeGeneration = useMutation(
    (api as any).pipeline.runs.adminResumeCourseGeneration
  );
  const retryRenderJob = useMutation(
    (api as any).pipeline.render.adminRetryRenderJob
  );
  const rerenderVideo = useMutation(
    (api as any).pipeline.render.adminRerenderVideo
  );
  const restartDispatchedRenderJob = useMutation(
    (api as any).pipeline.render.adminRestartDispatchedRenderJob
  );
  const cancelRenderJob = useMutation(
    (api as any).pipeline.render.adminCancelRenderJob
  );
  const cloneConvertedDoc = useMutation(api.pipeline.ingestion.adminCloneConvertedSourceDoc);
  const startRun = useMutation(api.pipeline.runs.adminStartRun);
  const runResult = useQuery(
    api.pipeline.queries.getRun,
    runId ? { runId } : "skip"
  );
  const cost = useQuery(
    api.pipeline.llmCalls.getRunCost,
    runId ? { runId } : "skip"
  );
  const compileProgress = useQuery(
    (api as any).pipeline.queries.getRunCompileProgress,
    runId ? { runId } : "skip"
  ) as RunCompileProgress | null | undefined;
  const runCourse = useQuery(
    api.pipeline.courses.getRunCourse,
    runId ? { runId } : "skip"
  ) as RunCourseRows | undefined;
  const sourceDocs = useQuery(api.pipeline.queries.listSourceDocs, {});
  const mediaSelection = useQuery(
    api.pipeline.assetsCatalogue.adminGetRunMediaSelection,
    runId ? { runId } : "skip"
  ) as RunMediaSelection | undefined;
  const renderStatus = useQuery(
    (api as any).pipeline.render.adminGetRunRenderStatus,
    runId ? { runId } : "skip"
  ) as RunRenderStatus | undefined;

  const run = runResult?.run;
  const events = runResult?.events ?? [];
  const docsForGeneration = useMemo(() => {
    if (!runId || !sourceDocs) return [];
    return sourceDocs.filter((doc) => doc.runId === runId);
  }, [runId, sourceDocs]);
  const courseMetrics = useMemo<CourseMetricSummary>(() => {
    if (runCourse) {
      return {
        modules: new Set(runCourse.units.map((unit) => unit.moduleKey)).size,
        units: runCourse.units.length,
        questions: runCourse.questions.length,
      };
    }
    return {
      modules: null,
      units: compileProgress?.totalUnits ?? null,
      questions: null,
    };
  }, [compileProgress?.totalUnits, runCourse]);
  const renderUnitMeta = useMemo(
    () => buildRenderUnitMeta(runCourse),
    [runCourse]
  );

  const docsConverted = docsForGeneration.filter((doc) => doc.status === "converted").length;
  const docsConverting = docsForGeneration.filter(
    (doc) => doc.status === "converting" || doc.status === "pending"
  ).length;
  const docsFailed = docsForGeneration.filter((doc) => doc.status === "failed").length;
  const latestEventAt = run
    ? events.length > 0
      ? events[events.length - 1]._creationTime
      : run._creationTime
    : 0;
  const compileLastActivityAt =
    compileProgress?.lastUnitAt ?? compileProgress?.compileStartedAt ?? latestEventAt;
  const resumableProcessingStates = new Set([
    "OUTLINING",
    "COMPILING",
    "GENERATING_SCRIPT",
    "GENERATING_ASSETS",
    "PUBLISHING",
  ]);
  const compileLikelyStalled = Boolean(
    run?.state === "COMPILING" && Date.now() - compileLastActivityAt > 15 * 60 * 1000
  );
  const processingStalled = Boolean(
    run &&
      resumableProcessingStates.has(run.state) &&
      (run.state === "COMPILING"
        ? compileLikelyStalled
        : Date.now() - latestEventAt > 5 * 60 * 1000)
  );
  const showResumeButton = Boolean(run && (run.state === "FAILED" || processingStalled));
  const stalledHint =
    run?.state === "COMPILING"
      ? "No compile activity in the last 15 minutes. You can safely resume."
      : "No pipeline activity in the last 5 minutes. You can safely resume.";
  const lastFailureEvent = [...events].reverse().find((event) => event.toState === "FAILED");
  const failedFromState = run?.state === "FAILED" ? lastFailureEvent?.fromState ?? null : null;
  const effectiveState = run?.state === "FAILED" ? failedFromState ?? "" : run?.state ?? "";
  const phase = phaseForState(effectiveState);
  const phaseIndex = phase.index;
  const percent = progressPercent(effectiveState, compileProgress);
  const currentSubstep = substepIndexForState(effectiveState);
  const recentEvents = [...events].reverse().slice(0, 5);
  const failureGuidance = buildFailureGuidance(run?.error?.cause);
  const failureCauseDisplay = describeFailureCause(run?.error?.cause);
  const operatorDetail = run
    ? buildOperatorDetail(run, lastFailureEvent, failureCauseDisplay)
    : "";
  const generationName = runResult?.courseTitle?.trim() || "Course generation";
  const runDetails = run
    ? {
        phase: phase.label,
        phaseIndex,
        runningFor: formatDuration(Date.now() - run._creationTime),
        sourcePages: docsForGeneration.reduce((total, doc) => total + (doc.pageCount ?? 0), 0),
      }
    : null;

  const onResume = async () => {
    if (!run) return;
    setResumeBusy(true);
    setResumeError(null);
    try {
      const result = (await resumeGeneration({ runId: run._id })) as { queued?: boolean };
      if (!result?.queued) {
        setResumeError(
          "This course generation is waiting for approval and has no background stage to resume."
        );
      }
    } catch (error) {
      setResumeError(
        getUserFacingErrorMessage(error, "Could not resume this course generation right now.")
      );
    } finally {
      setResumeBusy(false);
    }
  };

  const onCopyDetail = async () => {
    if (Platform.OS !== "web" || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(operatorDetail);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const onRestart = async () => {
    if (!run || docsForGeneration.length === 0) return;
    setRestartBusy(true);
    setRestartError(null);
    try {
      const sourceDocIds: Id<"sourceDocs">[] = [];
      for (const doc of docsForGeneration) {
        sourceDocIds.push(await cloneConvertedDoc({ sourceDocId: doc._id }));
      }
      const newRunId = await startRun({
        institutionId: run.institutionId,
        sourceDocIds,
        ...(run.brief?.trim() ? { brief: run.brief.trim() } : {}),
        ...(mediaSelection?.explicitSelection
          ? { assetIds: mediaSelection.assets.map((asset) => asset._id) }
          : {}),
      });
      router.push(`/admin/runs/${newRunId}`);
    } catch (error) {
      setRestartError(
        getUserFacingErrorMessage(error, "Could not restart this course generation. Try again.")
      );
      setRestartBusy(false);
    }
  };

  const onOpenRenderedVideo = async (video: PreviewVideo) => {
    setPreviewVideo(video);
    setVideoPreviewError(null);
    if (videoUrls.has(video.objectKey)) return;

    setPresigningVideoKey(video.objectKey);
    try {
      const results = await presignBatch({ keys: [video.objectKey] });
      setVideoUrls((current) => {
        const next = new Map(current);
        for (const result of results) next.set(result.key, result.url);
        return next;
      });
    } catch (error) {
      setVideoPreviewError(
        getUserFacingErrorMessage(error, "Could not load this rendered video. Try again.")
      );
    } finally {
      setPresigningVideoKey(null);
    }
  };

  const onDownloadRenderedVideo = async (video: PreviewVideo) => {
    if (Platform.OS !== "web") return;
    const variant = selectedRenderedVideoVariant(video);
    setVideoDownloadError(null);
    setDownloadingVideoKey(video.objectKey);
    try {
      const [download] = await presignDownloadBatch({
        items: [
          {
            key: video.objectKey,
            filename: videoFilename(video.title, variant.width, variant.height),
          },
        ],
      });
      if (!download) throw new Error("No download URL returned.");
      downloadFile(download.url, download.filename);
    } catch (error) {
      setVideoDownloadError(
        getUserFacingErrorMessage(error, "Could not prepare this video download. Try again.")
      );
    } finally {
      setDownloadingVideoKey(null);
    }
  };

  const headerDescription = run
    ? `${run.state === "PUBLISHED" ? "Built" : "Building"} from ${docsForGeneration.length} source document${docsForGeneration.length === 1 ? "" : "s"} · started ${formatDateTime(run._creationTime)}`
    : "Live progress and outputs for this course generation.";

  return (
    <AdminWorkspaceFrame
      activeNav="runs"
      title={generationName}
      titleAccessory={run ? <StatusBadge label={headerStatusLabel(run.state)} tone={headerStatusTone(run.state)} /> : null}
      description={headerDescription}
      topbarTrail={["Course queue", generationName]}
      headerActions={
        <Button variant="outline" onPress={() => router.push("/admin/runs")}>
          <ButtonText>Back to queue</ButtonText>
        </Button>
      }
    >
      <ScrollView className="flex-1 w-full">
        <Box className="pb-4">
          {runResult === undefined ? (
            <SurfaceCard>
              <Text className="text-muted-foreground">Loading course generation...</Text>
            </SurfaceCard>
          ) : !run ? (
            <SurfaceCard>
              <Text className="text-muted-foreground">Course generation not found.</Text>
            </SurfaceCard>
          ) : (
            <Box className="flex-row flex-wrap items-start gap-5 lg:gap-7">
              <Box className="min-w-0 flex-1 basis-[560px] gap-[18px]">
                {run.state === "FAILED" ? (
                  <FailedHero
                    runId={run._id}
                    failedPhase={phase.label}
                    retryable={Boolean(run.error?.retryable)}
                    summary={failureCauseDisplay.summary}
                    resumeBusy={resumeBusy}
                    resumeError={resumeError}
                     showFullLogs={showFullLogs}
                     confirmRestart={confirmRestart}
                     restartBusy={restartBusy}
                     restartDisabled={docsForGeneration.length === 0 || mediaSelection === undefined}
                     restartError={restartError}
                     onResume={() => void onResume()}
                     onToggleLogs={() => setShowFullLogs((value) => !value)}
                     onRequestRestart={() => {
                       setRestartError(null);
                       setConfirmRestart(true);
                     }}
                     onCancelRestart={() => setConfirmRestart(false)}
                     onRestart={() => void onRestart()}
                   />
                ) : (
                  <ProgressHero
                    runId={run._id}
                    state={run.state}
                    phase={phase.label}
                    phaseIndex={phaseIndex}
                    percent={percent}
                    startedAt={run._creationTime}
                    courseMetrics={courseMetrics}
                    compileProgress={compileProgress}
                    processingStalled={processingStalled}
                    stalledHint={stalledHint}
                    showResumeButton={showResumeButton}
                    resumeBusy={resumeBusy}
                    resumeError={resumeError}
                    onResume={() => void onResume()}
                  />
                )}

                {run.brief?.trim() ? (
                  <SurfaceCard title="Prompt brief" subtitle="The operator direction used to shape this course.">
                    <Text className="text-[13px] leading-5 text-secondary-foreground">
                      {run.brief.trim()}
                    </Text>
                  </SurfaceCard>
                ) : null}

                {run.state === "FAILED" ? (
                  <>
                    <FailureTrace failedState={effectiveState} />
                    <SurfaceCard title="What to try">
                      <Box className="gap-3">
                        {failureGuidance.map((tip, index) => (
                          <Box key={tip} className="flex-row items-start gap-3">
                            <Box className="h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
                              <Text className="text-[11px] font-bold text-primary-foreground">
                                {index + 1}
                              </Text>
                            </Box>
                            <Text className="flex-1 text-[13px] leading-5 text-secondary-foreground">
                              {tip}
                            </Text>
                          </Box>
                        ))}
                      </Box>
                    </SurfaceCard>
                    {showFullLogs ? (
                      <>
                        <OperatorDetail
                          detail={operatorDetail}
                          retryable={Boolean(run.error?.retryable)}
                          copied={copied}
                          copyAvailable={Platform.OS === "web"}
                          onCopy={() => void onCopyDetail()}
                        />
                        <ActivityCard events={[...events].reverse()} full />
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <PhaseProgress
                      state={effectiveState}
                      phaseIndex={phaseIndex}
                      currentSubstep={currentSubstep}
                      runId={run._id}
                      events={events}
                      docs={docsForGeneration}
                      courseMetrics={courseMetrics}
                      onViewFullLog={() => setShowFullLogs((value) => !value)}
                    />
                    {renderStatus && renderStatus.summary.total > 0 ? (
                      <RenderedOutputsCard
                        status={renderStatus}
                        unitMeta={renderUnitMeta}
                        retryingId={retryingRenderJobId}
                        rerenderingId={rerenderingRenderJobId}
                        restartingId={restartingRenderJobId}
                        cancellingId={cancellingRenderJobId}
                        presigningKey={presigningVideoKey}
                        downloadingKey={downloadingVideoKey}
                        downloadError={videoDownloadError}
                        onPreview={(video) => void onOpenRenderedVideo(video)}
                        onDownload={(video) => void onDownloadRenderedVideo(video)}
                        onRerender={async (jobId) => {
                          setRerenderingRenderJobId(String(jobId));
                          try {
                            await rerenderVideo({ jobId });
                          } finally {
                            setRerenderingRenderJobId(null);
                          }
                        }}
                        onRetry={async (jobId) => {
                          setRetryingRenderJobId(String(jobId));
                          try {
                            await retryRenderJob({ jobId });
                          } finally {
                            setRetryingRenderJobId(null);
                          }
                        }}
                        onCancel={async (jobId) => {
                          setCancellingRenderJobId(String(jobId));
                          try {
                            await cancelRenderJob({ jobId });
                          } finally {
                            setCancellingRenderJobId(null);
                          }
                        }}
                        onRestart={async (jobId) => {
                          setRestartingRenderJobId(String(jobId));
                          try {
                            await restartDispatchedRenderJob({ jobId });
                          } finally {
                            setRestartingRenderJobId(null);
                          }
                        }}
                      />
                    ) : null}
                    {run.state === "COMPILING" ? (
                      <CompileActivity progress={compileProgress} />
                    ) : null}
                    {showFullLogs ? <ActivityCard events={[...events].reverse()} full /> : null}
                  </>
                )}
              </Box>

              <Box className="w-full gap-[18px] lg:w-[336px] lg:shrink-0">
                {runDetails ? (
                  <RunDetailsCard
                    state={run.state}
                    details={runDetails}
                    docs={docsForGeneration}
                    converted={docsConverted}
                    converting={docsConverting}
                    failed={docsFailed}
                    mediaSelection={mediaSelection}
                  />
                ) : null}
                <CostCard cost={cost} final={!!["FAILED", "PUBLISHED"].includes(run.state)} />
                <AboutRunCard run={run} events={events} />
                {run.state === "FAILED" ? (
                  <ActivityCard events={recentEvents} compact />
                ) : null}
              </Box>
            </Box>
          )}
        </Box>
      </ScrollView>
      <RenderedVideoModal
        video={previewVideo}
        url={previewVideo ? videoUrls.get(previewVideo.objectKey) ?? null : null}
        loading={previewVideo ? presigningVideoKey === previewVideo.objectKey : false}
        error={videoPreviewError}
        onSelectVariant={(objectKey) => {
          if (!previewVideo || previewVideo.objectKey === objectKey) return;
          void onOpenRenderedVideo({ ...previewVideo, objectKey });
        }}
        onClose={() => {
          setPreviewVideo(null);
          setVideoPreviewError(null);
        }}
      />
    </AdminWorkspaceFrame>
  );
}

function ProgressHero({
  runId,
  state,
  phase,
  phaseIndex,
  percent,
  startedAt,
  courseMetrics,
  compileProgress,
  processingStalled,
  stalledHint,
  showResumeButton,
  resumeBusy,
  resumeError,
  onResume,
}: {
  runId: Id<"runs">;
  state: string;
  phase: string;
  phaseIndex: number;
  percent: number;
  startedAt: number;
  courseMetrics: CourseMetricSummary;
  compileProgress: RunCompileProgress | null | undefined;
  processingStalled: boolean;
  stalledHint: string;
  showResumeButton: boolean;
  resumeBusy: boolean;
  resumeError: string | null;
  onResume: () => void;
}) {
  const published = state === "PUBLISHED";
  const gate = GATE_STATES.has(state);
  const statusLabel = published ? "Published" : gate ? "Review required" : "In progress";
  const description = phaseDescription(state, compileProgress);
  const actionHref = actionHrefForState(runId, state);
  const showApprovalCta = gate && actionHref !== null;
  const qualityPassed = ["QA_PASSED", "GATE_2_COURSE_REVIEW", "GATE_2_QUIZ_REVIEW", "GENERATING_SCRIPT", "GENERATING_ASSETS", "GATE_3_PREVIEW", "PUBLISHING", "PUBLISHED"].includes(state);

  return (
    <Box
      className="gap-4 rounded-[14px] border border-[#E6CF9F] bg-card px-5 py-5 md:px-7"
      style={(gate ? { borderLeftWidth: 4, borderLeftColor: "#D88A0A" } : {}) as never}
    >
      <Box className="flex-row items-center gap-2.5">
        <Box
          className={`h-2.5 w-2.5 rounded-full ${
            published ? "bg-success" : gate ? "bg-[#D88A0A]" : "bg-success"
          }`}
        />
        <Text className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-[#9A6A15]">
          {statusLabel} · stage {phaseIndex + 1} of 5
        </Text>
      </Box>
      <Box className="gap-1">
        <Text className="text-[24px] font-bold leading-[29px] tracking-[-0.02em] text-foreground">
          {gate ? approvalHeadlineForState(state) : phaseHeadline(state)}
        </Text>
        <Text className="max-w-[720px] text-[14px] leading-5 text-secondary-foreground">
          {gate
            ? "All narration, cards and questions are drafted and quality-checked. Approve to continue to media and preview, or send it back with notes for another pass."
            : description}
        </Text>
      </Box>
      <Box className="flex-row flex-wrap gap-2">
        <MiniPill label={metricLabel(courseMetrics.modules, "module")} />
        <MiniPill label={metricLabel(courseMetrics.units, "unit")} />
        <MiniPill label={metricLabel(courseMetrics.questions, "question")} />
        {qualityPassed ? <MiniPill label="Quality checks passed" tone="success" /> : null}
      </Box>
      {!gate && !published ? (
        <Box
          className="h-1.5 w-full overflow-hidden rounded-full bg-border"
          accessibilityRole="progressbar"
          accessibilityLabel="Course generation progress"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
        >
          <Box className="h-1.5 rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </Box>
      ) : null}
      <Box className="h-px bg-border" />
      <Box className="flex-row flex-wrap items-center gap-3">
        {showApprovalCta ? (
          <Link href={actionHref}>
            <Box className="rounded-[9px] bg-primary px-6 py-3.5">
              <Text className="text-[13px] font-bold text-primary-foreground">
                {primaryCtaForState(state)}
              </Text>
            </Box>
          </Link>
        ) : null}
        {showApprovalCta ? (
          <Link href={actionHref}>
            <Box className="rounded-[9px] border border-input bg-card px-5 py-3.5">
              <Text className="text-[13px] font-bold text-foreground">Request changes</Text>
            </Box>
          </Link>
        ) : null}
        <Text className="text-[12px] text-muted-foreground">
          {gate
            ? "Generation stays paused until you decide."
            : `Running for ${formatDuration(Date.now() - startedAt)} · ${phase} · ${percent}%`}
        </Text>
      </Box>
      {processingStalled ? (
        <Box className="gap-2 border-t border-border pt-3">
          <Text className="text-xs text-secondary-foreground">{stalledHint}</Text>
          {showResumeButton ? (
            <Button size="sm" variant="outline" className="self-start" onPress={onResume} isDisabled={resumeBusy}>
              <ButtonText>{resumeBusy ? "Resuming..." : "Resume this stage"}</ButtonText>
            </Button>
          ) : null}
        </Box>
      ) : null}
      {resumeError ? <Text className="text-xs text-destructive">{resumeError}</Text> : null}
    </Box>
  );
}

function MiniPill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" }) {
  return (
    <Box
      className={`self-start rounded-full px-3 py-1.5 ${
        tone === "success" ? "bg-success-muted" : "bg-muted"
      }`}
    >
      <Text
        className={`text-[12px] font-bold ${
          tone === "success" ? "text-success-muted-foreground" : "text-secondary-foreground"
        }`}
      >
        {tone === "success" ? "✓ " : ""}{label}
      </Text>
    </Box>
  );
}

function RunDetailsCard({
  state,
  details,
  docs,
  converted,
  converting,
  failed,
  mediaSelection,
}: {
  state: string;
  details: { phase: string; phaseIndex: number; runningFor: string; sourcePages: number };
  docs: Doc<"sourceDocs">[];
  converted: number;
  converting: number;
  failed: number;
  mediaSelection: RunMediaSelection | undefined;
}) {
  const docsReady = docs.length > 0 && converted === docs.length;
  return (
    <SurfaceCard
      title="Run details"
      actions={<StatusBadge label={compactStatusLabel(state)} tone={headerStatusTone(state)} />}
    >
      <Box className="gap-4">
        <CompactStatRow label="Running for" value={details.runningFor} />
        <CompactStatRow label="Current phase" value={`${details.phaseIndex + 1} of 5 · ${details.phase}`} />

        <Box className="border-t border-border pt-4">
          <CompactStatRow
            label="Source documents"
            value={`${docs.length} · ${details.sourcePages} pp`}
          />
          <Box className="mt-2">
            <StatusBadge
              label={`${converted}/${docs.length} ${docsReady ? "ready" : "converted"}`}
              tone={failed > 0 ? "danger" : converting > 0 ? "warning" : docsReady ? "success" : "neutral"}
            />
          </Box>
        </Box>

        <Box className="border-t border-border pt-4">
          <CompactStatRow
            label="Media selected"
            value={mediaSelection ? `${mediaSelection.counts.selected} items` : "Loading..."}
          />
          {mediaSelection ? (
            <Box className="mt-2">
              <StatusBadge
                label={mediaSelection.counts.needsRights > 0 ? `${mediaSelection.counts.needsRights} need rights` : "All rights cleared"}
                tone={mediaSelection.counts.needsRights > 0 ? "warning" : "success"}
              />
            </Box>
          ) : null}
        </Box>
      </Box>
    </SurfaceCard>
  );
}

function AboutRunCard({ run, events }: { run: Doc<"runs">; events: RunEvent[] }) {
  const startedBy = displayActor(events[0]?.actor);
  return (
    <SurfaceCard title="About this run">
      <Box className="gap-3">
        <CompactStatRow label="Started" value={formatDateTime(run._creationTime)} />
        <CompactStatRow label="Started by" value={startedBy} />
        <CompactStatRow label="Model routing" value="Balanced" />
        <CompactStatRow label="Run ID" value={shortRunId(run._id)} muted />
        <Box className="border-t border-border pt-3">
          <Link href="/admin/email-test">
            <Text className="text-[12.5px] font-bold text-foreground">Open in Diagnostics</Text>
          </Link>
        </Box>
      </Box>
    </SurfaceCard>
  );
}

function CompactStatRow({
  label,
  value,
  success,
  muted,
}: {
  label: string;
  value: string;
  success?: boolean;
  muted?: boolean;
}) {
  return (
    <Box className="flex-row items-start justify-between gap-3">
      <Text className="text-[12.5px] text-muted-foreground">{label}</Text>
      <Text
        className={`max-w-[170px] text-right text-[12.5px] font-bold ${
          success ? "text-success-muted-foreground" : muted ? "text-muted-foreground" : "text-foreground"
        }`}
        numberOfLines={2}
      >
        {value}
      </Text>
    </Box>
  );
}

function FailedHero({
  runId,
  failedPhase,
  retryable,
  summary,
  resumeBusy,
  resumeError,
  showFullLogs,
  confirmRestart,
  restartBusy,
  restartDisabled,
  restartError,
  onResume,
  onToggleLogs,
  onRequestRestart,
  onCancelRestart,
  onRestart,
}: {
  runId: Id<"runs">;
  failedPhase: string;
  retryable: boolean;
  summary: string;
  resumeBusy: boolean;
  resumeError: string | null;
  showFullLogs: boolean;
  confirmRestart: boolean;
  restartBusy: boolean;
  restartDisabled: boolean;
  restartError: string | null;
  onResume: () => void;
  onToggleLogs: () => void;
  onRequestRestart: () => void;
  onCancelRestart: () => void;
  onRestart: () => void;
}) {
  return (
    <Box className="overflow-hidden rounded-[14px] border border-[#EBD4D0] bg-card">
      <Box className="flex-row items-start gap-4 border-b border-[#F1DBD6] bg-[#FBEEEB] px-5 py-[22px] md:px-6">
        <Box className="h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#B0392C]">
          <Text className="text-xl font-bold text-white">!</Text>
        </Box>
        <Box className="flex-1 gap-1.5">
          <Text className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-[#B0392C]">
            Stopped · {retryable ? "can be retried" : "review required"}
          </Text>
          <Text className="text-xl font-bold tracking-[-0.01em] text-foreground">
            Generation stopped during {failedPhase.toLowerCase()}
          </Text>
          <Text className="text-[13.5px] leading-5 text-secondary-foreground">{summary}</Text>
          <Text className="text-[13px] leading-5 text-muted-foreground">
            Earlier work is kept. Resume retries the real failed stage without restarting the generation.
          </Text>
          <Text className="text-[10.5px] text-muted-foreground" selectable>
            Run {runId}
          </Text>
        </Box>
      </Box>
      <Box className="flex-row flex-wrap items-center gap-3 px-5 py-[18px] md:px-6">
        <Button onPress={onResume} isDisabled={resumeBusy || !retryable}>
          <ButtonText>
            {resumeBusy
              ? "Resuming..."
              : retryable
                ? `Resume from “${failedPhase}”`
                : "This run cannot be resumed"}
          </ButtonText>
        </Button>
        <Button variant="outline" onPress={onToggleLogs}>
          <ButtonText>{showFullLogs ? "Hide full logs" : "View full logs"}</ButtonText>
        </Button>
        {confirmRestart ? (
          <>
            <Text className="w-full text-xs leading-5 text-muted-foreground">
              Restarting creates a new run from the same sources and media. This failed run and its logs are kept.
            </Text>
            <Button variant="outline" onPress={onCancelRestart} isDisabled={restartBusy}>
              <ButtonText>Cancel</ButtonText>
            </Button>
            <Button variant="destructive" onPress={onRestart} isDisabled={restartBusy || restartDisabled}>
              <ButtonText>{restartBusy ? "Restarting..." : "Confirm restart"}</ButtonText>
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            className="border-destructive"
            onPress={onRequestRestart}
            isDisabled={restartDisabled}
          >
            <ButtonText className="text-destructive">Restart generation</ButtonText>
          </Button>
        )}
        {resumeError ? <Text className="w-full text-sm text-destructive">{resumeError}</Text> : null}
        {restartError ? <Text className="w-full text-sm text-destructive">{restartError}</Text> : null}
      </Box>
    </Box>
  );
}

function PhaseProgress({
  state,
  phaseIndex,
  currentSubstep,
  runId,
  events,
  docs,
  courseMetrics,
  onViewFullLog,
}: {
  state: string;
  phaseIndex: number;
  currentSubstep: number;
  runId: Id<"runs">;
  events: RunEvent[];
  docs: Doc<"sourceDocs">[];
  courseMetrics: CourseMetricSummary;
  onViewFullLog: () => void;
}) {
  return (
    <SurfaceCard
      title="Progress"
      subtitle={`${Math.min(phaseIndex, PHASES.length - 1)} of ${PHASES.length} stages complete`}
      actions={
        <Pressable onPress={onViewFullLog} accessibilityRole="button" accessibilityLabel="View full run log">
          <Text className="text-[12px] font-semibold text-secondary-foreground">View full log</Text>
        </Pressable>
      }
    >
      <Box className="gap-0">
        {PHASES.map((phase, index) => {
          const complete = index < phaseIndex || state === "PUBLISHED";
          const current = index === phaseIndex && state !== "PUBLISHED";
          const gate = current && GATE_STATES.has(state);
          const viewLink = phaseViewLink(runId, state, index, complete, current, docs);
          const details = phaseDetailLines({
            phaseIndex: index,
            state,
            currentSubstep,
            events,
            docs,
            courseMetrics,
          });

          return (
            <Box
              key={phase.label}
              className={`flex-row gap-4 ${index < PHASES.length - 1 ? "pb-5" : ""}`}
            >
              <Box className="items-center">
                <Box
                  className={`h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                    complete
                      ? "border-success bg-success"
                      : current
                        ? gate
                          ? "border-[#D88A0A] bg-[#D88A0A]"
                          : "border-primary bg-primary"
                        : "border-border bg-muted"
                  }`}
                >
                  <Text
                    className={`text-[12px] font-bold ${
                      complete || current ? "text-white" : "text-muted-foreground"
                    }`}
                  >
                    {complete ? "✓" : index + 1}
                  </Text>
                </Box>
                {index < PHASES.length - 1 ? <Box className="w-px flex-1 bg-border" /> : null}
              </Box>
              <Box className="min-w-0 flex-1 gap-1.5 pb-1">
                <Box className="flex-row flex-wrap items-center justify-between gap-2">
                  <Text className={`min-w-0 flex-1 text-[14px] font-bold ${current || complete ? "text-foreground" : "text-secondary-foreground"}`}>
                    {index + 1} · {phase.label}
                  </Text>
                  <PhaseActionLabel complete={complete} current={current} gate={gate} index={index} phaseIndex={phaseIndex} />
                </Box>
                <Box className="flex-row items-start justify-between gap-3">
                  <Box className="min-w-0 flex-1 gap-1.5">
                    {details.map((line) => (
                      <Text key={line} className="text-[12px] leading-[18px] text-muted-foreground">
                        {line}
                      </Text>
                    ))}
                  </Box>
                  {viewLink ? <PhaseViewButton href={viewLink.href} label={viewLink.label} /> : null}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </SurfaceCard>
  );
}

function PhaseActionLabel({
  complete,
  current,
  gate,
  index,
  phaseIndex,
}: {
  complete: boolean;
  current: boolean;
  gate: boolean;
  index: number;
  phaseIndex: number;
}) {
  return (
    <Text
      className={`text-[12px] font-semibold ${
        complete
          ? "text-success-muted-foreground"
          : current
            ? "text-foreground"
            : index === phaseIndex + 1
              ? "text-muted-foreground"
              : "text-muted-foreground"
      }`}
    >
      {complete ? "Complete" : gate ? "Review required" : current ? "In progress" : "Upcoming"}
    </Text>
  );
}

function PhaseViewButton({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href}>
      <Box className="rounded-full border border-input bg-card px-3 py-1.5 data-[hover=true]:bg-secondary">
        <Text className="text-[11.5px] font-bold text-foreground">
          {label}
        </Text>
      </Box>
    </Link>
  );
}

function phaseViewLink(
  runId: Id<"runs">,
  state: string,
  index: number,
  complete: boolean,
  current: boolean,
  docs: Doc<"sourceDocs">[]
): { href: string; label: string } | null {
  if (current && GATE_STATES.has(state)) {
    const href = actionHrefForState(runId, state);
    return href ? { href, label: actionLabelForState(state) } : null;
  }
  if (!complete) return null;
  if (index === 0) {
    return {
      href: docs.length === 1 ? `/admin/source-docs/${docs[0]!._id}` : "/admin/source-docs",
      label: docs.length === 1 ? "View source document" : "View source documents",
    };
  }
  if (index === 1) return { href: `/admin/runs/${runId}/outline`, label: "View approved outline" };
  if (index === 2) return { href: `/admin/runs/${runId}/gate-2`, label: "View approved course" };
  if (index === 3) return { href: `/admin/runs/${runId}/gate-3`, label: "View approved preview" };
  return null;
}

function phaseDetailLines({
  phaseIndex,
  state,
  currentSubstep,
  events,
  docs,
  courseMetrics,
}: {
  phaseIndex: number;
  state: string;
  currentSubstep: number;
  events: RunEvent[];
  docs: Doc<"sourceDocs">[];
  courseMetrics: CourseMetricSummary;
}): string[] {
  const eventTime = (states: string[]) => {
    const event = [...events].reverse().find((item) => states.includes(item.toState));
    return event ? formatClockTime(event._creationTime) : null;
  };
  const withTime = (label: string, time: string | null) => (time ? `${label} · ${time}` : label);

  if (phaseIndex === 0) {
    return [
      withTime(`Converted ${docs.length} document${docs.length === 1 ? "" : "s"}`, eventTime(["CONVERTED", "EXTRACTING"])),
      withTime("Extracted & reviewed key facts", eventTime(["EXTRACTED", "GATE_1_KNOWLEDGE_REVIEW", "OUTLINING"])),
    ];
  }

  if (phaseIndex === 1) {
    if (["OUTLINING"].includes(state)) return ["Drafting the outline from approved source facts."];
    if (state === "OUTLINE_REVIEW") return [withTime("Draft outline is ready for your approval", eventTime(["OUTLINE_REVIEW"]))];
    return [withTime("You approved the outline", eventTime(["COMPILING", "COMPILED"]))];
  }

  if (phaseIndex === 2) {
    const unitLabel = metricLabel(courseMetrics.units, "unit");
    const questionLabel = metricLabel(courseMetrics.questions, "question");
    const moduleLabel = metricLabel(courseMetrics.modules, "module");
    if (["COMPILING"].includes(state)) {
      return [
        `Writing narration & cards · ${unitLabel}`,
        currentSubstep > 0 ? "Quality checks queued next." : "Quality checks will run after authoring.",
      ];
    }
    return [
      withTime(`Quality checks passed · ${unitLabel} · ${questionLabel}`, eventTime(["QA_PASSED", "GATE_2_COURSE_REVIEW", "GATE_2_QUIZ_REVIEW"])),
      withTime(`Wrote narration & cards · ${moduleLabel}`, eventTime(["COMPILED", "QA_RUNNING"])),
    ];
  }

  if (phaseIndex === 3) {
    if (["GENERATING_SCRIPT", "GENERATING_ASSETS", "GATE_3_PREVIEW"].includes(state)) {
      return [withTime("Generating voice & visuals", eventTime(["GENERATING_SCRIPT", "GENERATING_ASSETS"])), "Preview approval comes next."];
    }
    return ["Generate voice & visuals, then a preview approval."];
  }

  if (state === "PUBLISHED") return [withTime("Published to delivery targets", eventTime(["PUBLISHED"]))];
  return ["Publish to your delivery targets."];
}

function FailureTrace({ failedState }: { failedState: string }) {
  const failedPhaseIndex = phaseForState(failedState).index;
  return (
    <SurfaceCard title="Where it stopped">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Box className="min-w-[620px] flex-row items-start pr-2">
          {PHASES.map((phase, index) => {
            const complete = index < failedPhaseIndex;
            const failed = index === failedPhaseIndex;
            return (
              <Box key={phase.label} className="min-w-[116px] flex-1 flex-row items-start">
                <Box className="items-center gap-2">
                  <Box
                    className={`h-[30px] w-[30px] items-center justify-center rounded-full ${
                      failed ? "bg-[#B0392C]" : complete ? "bg-success" : "bg-muted"
                    }`}
                  >
                    <Text className={`text-xs font-bold ${failed || complete ? "text-white" : "text-muted-foreground"}`}>
                      {failed ? "!" : complete ? "✓" : index + 1}
                    </Text>
                  </Box>
                  <Text
                    className={`max-w-[100px] text-center text-[11.5px] font-semibold ${
                      failed ? "text-[#B0392C]" : complete ? "text-secondary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {phase.shortLabel}
                  </Text>
                </Box>
                {index < PHASES.length - 1 ? (
                  <Box className={`mt-[14px] h-0.5 flex-1 ${index < failedPhaseIndex ? "bg-[#E3B7AF]" : "bg-border"}`} />
                ) : null}
              </Box>
            );
          })}
        </Box>
      </ScrollView>
    </SurfaceCard>
  );
}

function OperatorDetail({
  detail,
  retryable,
  copied,
  copyAvailable,
  onCopy,
}: {
  detail: string;
  retryable: boolean;
  copied: boolean;
  copyAvailable: boolean;
  onCopy: () => void;
}) {
  return (
    <Box className="gap-3 rounded-[14px] bg-[#1F1E1B] px-[22px] py-5">
      <Box className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-[13px] font-bold text-white">Error detail</Text>
        <Text className="text-[11.5px] text-[#9A978C]">
          for operators · retryable: {retryable ? "yes" : "no"}
        </Text>
      </Box>
      <Box className="rounded-[9px] bg-[#161512] px-4 py-3.5">
        <Text className="text-xs leading-5 text-[#D6D3C8]" selectable>
          {detail}
        </Text>
      </Box>
      {copyAvailable ? (
        <Pressable
          className="self-start rounded-lg bg-white/10 px-3 py-2 data-[hover=true]:bg-white/15"
          onPress={onCopy}
          accessibilityRole="button"
          accessibilityLabel="Copy operator error detail"
        >
          <Text className="text-xs font-semibold text-white">{copied ? "Copied" : "Copy detail"}</Text>
        </Pressable>
      ) : null}
    </Box>
  );
}

function ActivityCard({
  events,
  compact = false,
  full = false,
}: {
  events: RunEvent[];
  compact?: boolean;
  full?: boolean;
}) {
  return (
    <SurfaceCard title={full ? "Full event log" : compact ? "Activity" : "Recent activity"}>
      {events.length === 0 ? (
        <Text className="text-sm text-muted-foreground">No events yet.</Text>
      ) : (
        <Box>
          {events.map((event, index) => {
            const failed = event.toState === "FAILED";
            return (
              <Box
                key={event._id}
                className={`flex-row items-start gap-3 ${index > 0 ? "border-t border-border pt-3" : ""} ${
                  index < events.length - 1 ? "pb-3" : ""
                }`}
              >
                <Box className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${failed ? "bg-destructive" : index === 0 ? "bg-primary" : "bg-border"}`} />
                <Box className="flex-1">
                  <Text className={`text-[12.5px] font-semibold ${failed ? "text-destructive" : "text-foreground"}`}>
                    {eventTitle(event)}
                  </Text>
                  <Text className="text-[11.5px] text-muted-foreground">
                    {formatEventTime(event._creationTime)} · {event.actor}
                  </Text>
                  {event.detail ? (
                    <Text
                      className="mt-0.5 text-[11.5px] leading-4 text-muted-foreground"
                      numberOfLines={full ? undefined : compact ? 2 : 4}
                      selectable={full}
                    >
                      {humanizeGeneratedUnitKeyText(event.detail)}
                    </Text>
                  ) : null}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </SurfaceCard>
  );
}

function CompileActivity({ progress }: { progress: RunCompileProgress | null | undefined }) {
  const totalLabel =
    typeof progress?.totalUnits === "number" && progress.totalUnits > 0
      ? `${progress.processedUnits}/${progress.totalUnits} units authored`
      : `${progress?.processedUnits ?? 0} units authored`;
  return (
    <SurfaceCard title="Course build activity" subtitle={totalLabel}>
      {typeof progress?.etaMs === "number" && progress.etaMs > 0 ? (
        <Text className="text-xs text-muted-foreground">Estimated time remaining: {formatEta(progress.etaMs)}</Text>
      ) : null}
      {progress?.recentUnits?.length ? (
        <Box>
          {progress.recentUnits.slice(0, 5).map((unit, index) => (
            <Box key={`${unit.unitId}-${unit.createdAt}`} className={`py-2 ${index > 0 ? "border-t border-border" : ""}`}>
              <Text className={`text-xs font-semibold ${unit.status === "error" ? "text-destructive" : "text-foreground"}`}>
                {humanizeGeneratedUnitKeyText(unit.label)} · {unit.status === "ok" ? "authored" : "error"}
              </Text>
              <Text className="text-[11.5px] text-muted-foreground">
                {formatEventTime(unit.createdAt)}
                {unit.warningCount > 0 ? ` · ${unit.warningCount} warning${unit.warningCount === 1 ? "" : "s"}` : ""}
              </Text>
              {unit.cause ? <Text className="text-[11.5px] text-destructive">{unit.cause}</Text> : null}
            </Box>
          ))}
        </Box>
      ) : (
        <Text className="text-xs text-muted-foreground">Waiting for the first authored unit result...</Text>
      )}
    </SurfaceCard>
  );
}

function CostCard({ cost, final }: { cost: ReturnType<typeof useQuery<typeof api.pipeline.llmCalls.getRunCost>>; final: boolean }) {
  return (
    <SurfaceCard title="LLM costs" subtitle={final ? "Final model usage for this run." : "Updates live as the course builds."}>
      {cost === undefined ? (
        <Text className="text-sm text-muted-foreground">Loading cost...</Text>
      ) : (
        <Box className="gap-3">
          <StatRow label="Text (LLM)" value={`$${cost.totalUsd.toFixed(4)}`} />
          <StatRow label="Voice (TTS)" value={`$${cost.tts.totalUsd.toFixed(4)}`} />
          <Box className="border-t border-border pt-3">
            <StatRow label={final ? "Total" : "Total so far"} value={`$${cost.grandTotalUsd.toFixed(4)}`} success />
          </Box>
          <Text className="text-[11.5px] text-muted-foreground">
            {cost.totalCalls} text call{cost.totalCalls === 1 ? "" : "s"} · {cost.tts.totalCalls} voice call{cost.tts.totalCalls === 1 ? "" : "s"}
          </Text>
          {cost.byStage.length > 0 ? (
            <Box className="gap-1 border-t border-border pt-3">
              {cost.byStage.slice(0, 8).map((row) => (
                <Text key={`${row.stage}-${row.model}`} className="text-[11.5px] text-muted-foreground">
                  {friendlyState(row.stage)} · ${row.costUsd.toFixed(4)} · {row.calls} call{row.calls === 1 ? "" : "s"}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
      )}
    </SurfaceCard>
  );
}

function SourceDocumentsCard({
  docs,
  converted,
  converting,
  failed,
}: {
  docs: Doc<"sourceDocs">[];
  converted: number;
  converting: number;
  failed: number;
}) {
  const ready = docs.length > 0 && converted === docs.length;
  return (
    <SurfaceCard
      title="Source documents"
      actions={
        <StatusBadge
          label={`${converted}/${docs.length} ${ready ? "ready" : "converted"}`}
          tone={failed > 0 ? "danger" : converting > 0 ? "warning" : ready ? "success" : "neutral"}
        />
      }
    >
      {docs.length === 0 ? (
        <Text className="text-sm text-muted-foreground">No source documents attached to this generation.</Text>
      ) : (
        <Box className="gap-3">
          {docs.map((doc) => (
            <Box key={doc._id} className="flex-row items-center justify-between gap-3">
              <Link href={`/admin/source-docs/${doc._id}`}>
                <Text className="flex-1 text-[12.5px] font-medium text-foreground" numberOfLines={2}>
                  {docTitle(doc)}
                </Text>
              </Link>
              <Text className={`text-[11.5px] ${doc.status === "failed" ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                {doc.pageCount ?? 0} pp · {doc.status}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </SurfaceCard>
  );
}

function MediaSelectionCard({ selection }: { selection: RunMediaSelection | undefined }) {
  return (
    <SurfaceCard
      title="Media selection"
      subtitle={selection?.explicitSelection ? "Selected for this course." : "Using the institution media catalogue."}
      actions={
        selection ? (
          <StatusBadge
            label={`${selection.counts.cleared}/${selection.counts.selected} cleared`}
            tone={selection.counts.needsRights > 0 ? "warning" : "success"}
          />
        ) : null
      }
    >
      {!selection ? (
        <Text className="text-sm text-muted-foreground">Loading media selection...</Text>
      ) : selection.counts.selected === 0 ? (
        <Text className="text-sm text-muted-foreground">No media assets selected.</Text>
      ) : (
        <Box className="gap-3">
          <Box className="flex-row flex-wrap gap-2">
            <StatusBadge label={`${selection.counts.selected} selected`} tone="neutral" />
            {selection.counts.needsRights > 0 ? (
              <StatusBadge label={`${selection.counts.needsRights} need rights`} tone="danger" />
            ) : null}
          </Box>
          {selection.assets.slice(0, 4).map((asset) => (
            <Box key={asset._id} className="flex-row items-start justify-between gap-3">
              <Text className="flex-1 text-[12px] text-secondary-foreground" numberOfLines={2}>
                {asset.caption?.trim() || `${asset.kind} asset`}
              </Text>
              <Text className={`text-[11px] font-semibold ${asset.cleared ? "text-success-muted-foreground" : "text-destructive"}`}>
                {asset.cleared ? "Cleared" : asset.rights === "unknown" ? "Rights needed" : "Consent needed"}
              </Text>
            </Box>
          ))}
          {selection.assets.length > 4 ? (
            <Text className="text-[11.5px] text-muted-foreground">+{selection.assets.length - 4} more selected assets</Text>
          ) : null}
        </Box>
      )}
    </SurfaceCard>
  );
}

function OutputsCard({
  runId,
  state,
  failedFromState,
}: {
  runId: Id<"runs">;
  state: string;
  failedFromState: string | null;
}) {
  const effectiveState = state === "FAILED" ? failedFromState ?? "" : state;
  const phaseIndex = phaseForState(effectiveState).index;
  const outputs = [
    { label: "Course outline", helper: "Title, outcomes, structure", href: `/admin/runs/${runId}/outline`, phase: 1 },
    { label: "Full course", helper: "Narration, cards, questions", href: `/admin/runs/${runId}/gate-2`, phase: 2 },
    { label: "Playable preview", helper: "Script, timing, media", href: `/admin/runs/${runId}/gate-3`, phase: 3 },
  ];
  return (
    <SurfaceCard title="Outputs">
      <Box className="gap-4">
        {outputs.map((output) => {
          const available = phaseIndex >= output.phase;
          const current = phaseIndex === output.phase;
          return (
            <Box key={output.label} className="flex-row items-center justify-between gap-3">
              <Box className="flex-1">
                <Text className="text-[13px] font-semibold text-foreground">{output.label}</Text>
                <Text className="text-[11.5px] text-muted-foreground">{output.helper}</Text>
              </Box>
              {available ? (
                <Link href={output.href}>
                  <StatusBadge label={current ? "Current" : "Ready"} tone={current ? "accent" : "success"} />
                </Link>
              ) : (
                <StatusBadge label="Pending" tone="neutral" />
              )}
            </Box>
          );
        })}
      </Box>
    </SurfaceCard>
  );
}

function RenderedOutputsCard({
  status,
  unitMeta,
  retryingId,
  rerenderingId,
  restartingId,
  cancellingId,
  presigningKey,
  downloadingKey,
  downloadError,
  onPreview,
  onDownload,
  onRerender,
  onRetry,
  onCancel,
  onRestart,
}: {
  status: RunRenderStatus;
  unitMeta: Map<string, RenderUnitMeta>;
  retryingId: string | null;
  rerenderingId: string | null;
  restartingId: string | null;
  cancellingId: string | null;
  presigningKey: string | null;
  downloadingKey: string | null;
  downloadError: string | null;
  onPreview: (video: PreviewVideo) => void;
  onDownload: (video: PreviewVideo) => void;
  onRerender: (jobId: Id<"renderJobs">) => Promise<void>;
  onRetry: (jobId: Id<"renderJobs">) => Promise<void>;
  onCancel: (jobId: Id<"renderJobs">) => Promise<void>;
  onRestart: (jobId: Id<"renderJobs">) => Promise<void>;
}) {
  return (
    <SurfaceCard
      title="Rendered outputs"
      subtitle="Final MP4 files for each micro-unit. Review outputs here before delivery."
      actions={
        <StatusBadge
          label={`${status.summary.succeeded}/${status.summary.total} ready`}
          tone={status.summary.failed > 0 ? "danger" : status.summary.succeeded === status.summary.total ? "success" : "warning"}
        />
      }
    >
      <Box className="flex-row flex-wrap gap-2">
        <RenderSummaryPill label={`${status.summary.queued} queued`} count={status.summary.queued} tone="warning" />
        <RenderSummaryPill label={`${status.summary.dispatched} dispatched`} count={status.summary.dispatched} tone="warning" />
        <RenderSummaryPill label={`${status.summary.rendering} rendering`} count={status.summary.rendering} tone="accent" />
        <RenderSummaryPill label={`${status.summary.failed} failed`} count={status.summary.failed} tone="danger" />
        <RenderSummaryPill label={`${status.summary.cancelled} cancelled`} count={status.summary.cancelled} tone="neutral" />
      </Box>
      {downloadError ? <Text className="text-xs text-destructive">{downloadError}</Text> : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="w-full"
        contentContainerStyle={{ minWidth: "100%" } as never}
      >
        <Box
          className="w-full min-w-[1010px] overflow-hidden rounded-[12px] border border-border"
          style={{ width: "100%" } as never}
        >
          <Box className="flex-row items-center gap-4 border-b border-border bg-background px-4 py-3">
            <TableHeader className="w-[245px]">Unit</TableHeader>
            <TableHeader className="w-[190px]">Module</TableHeader>
            <TableHeader className="w-[115px]">Status</TableHeader>
            <TableHeader className="w-[220px]">Video renditions</TableHeader>
            <TableHeader className="w-[86px]">Attempts</TableHeader>
            <TableHeader className="flex-1 text-right">Action</TableHeader>
          </Box>
          {status.jobs.map((job, index) => {
            const meta = unitMeta.get(job.unitId) ?? fallbackRenderUnitMeta(job);
            const output = job.output;
            const position = unitPositionLabel(meta, job);
            const title = `${position} ${meta.unitLabel}`;
            const subtitle = `${modulePositionLabel(meta)} · ${meta.moduleLabel}`;
            const ready = job.status === "succeeded" && output !== null;
            return (
              <Box
                key={job._id}
                className={`flex-row items-center gap-4 px-4 py-3.5 ${index > 0 ? "border-t border-border" : ""}`}
              >
                <Box className="w-[245px] min-w-0 gap-0.5">
                  <Text className="text-[13px] font-bold text-foreground" numberOfLines={2}>
                    {title}
                  </Text>
                  <Text className="text-[11.5px] text-muted-foreground" numberOfLines={1}>
                    Micro-unit {position}
                  </Text>
                </Box>
                <Box className="w-[190px] min-w-0 gap-0.5">
                  <Text className="text-[12.5px] font-semibold text-secondary-foreground" numberOfLines={2}>
                    {subtitle}
                  </Text>
                  <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
                    {modulePositionLabel(meta)}
                  </Text>
                </Box>
                <Box className="w-[115px]">
                  <StatusBadge label={renderStatusLabel(job.status)} tone={renderStatusTone(job.status)} />
                </Box>
                <Box className="w-[220px] gap-0.5">
                  <Text className="text-[12.5px] font-semibold text-foreground">
                    {output ? formatDurationLong(output.durationMs) : "Pending"}
                  </Text>
                  <Text className="text-[11px] text-muted-foreground">
                    {output
                      ? `${renderedVideoVariants(output).length} rendition${renderedVideoVariants(output).length === 1 ? "" : "s"} · ${output.fps}fps`
                      : "MP4 not available yet"}
                  </Text>
                  {output ? (
                    <Text className="text-[10.5px] leading-4 text-muted-foreground" numberOfLines={2}>
                      {renderedVideoVariants(output)
                        .map((variant) => `${variant.width}x${variant.height}`)
                        .join(" · ")}
                    </Text>
                  ) : null}
                  {job.rendererVersion ? (
                    <Text className="text-[10.5px] text-muted-foreground">
                      {job.rendererVersion}
                    </Text>
                  ) : null}
                </Box>
                <Box className="w-[86px]">
                  <Text className="text-[12.5px] font-semibold text-secondary-foreground">
                    {job.attempts}/{job.maxAttempts}
                  </Text>
                </Box>
                <Box className="min-w-0 flex-1 flex-row flex-wrap items-center justify-end gap-2">
                  {ready ? (
                    <Pressable
                      className="rounded-full bg-primary px-3 py-2 data-[hover=true]:opacity-90"
                      onPress={() =>
                        onPreview({
                          jobId: job._id,
                          objectKey: output.objectKey,
                          title,
                          subtitle,
                          meta,
                          output,
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Preview rendered video for ${title}`}
                    >
                      <Text className="text-[12px] font-bold text-primary-foreground">
                        {presigningKey === output.objectKey ? "Loading..." : "Preview video"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {ready && Platform.OS === "web" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={downloadingKey === output.objectKey}
                      onPress={() =>
                        onDownload({
                          jobId: job._id,
                          objectKey: output.objectKey,
                          title,
                          subtitle,
                          meta,
                          output,
                        })
                      }
                    >
                      <ButtonText>
                        {downloadingKey === output.objectKey ? "Preparing..." : "Download MP4"}
                      </ButtonText>
                    </Button>
                  ) : null}
                  {job.status === "queued" || job.status === "dispatched" || job.status === "rendering" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={cancellingId === String(job._id)}
                      onPress={() => void onCancel(job._id)}
                    >
                      <ButtonText>{cancellingId === String(job._id) ? "Cancelling..." : "Cancel render"}</ButtonText>
                    </Button>
                  ) : null}
                  {job.status === "dispatched" || job.status === "rendering" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={restartingId === String(job._id)}
                      onPress={() => void onRestart(job._id)}
                    >
                      <ButtonText>{restartingId === String(job._id) ? "Restarting..." : "Restart render"}</ButtonText>
                    </Button>
                  ) : null}
                  {ready ? (
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={rerenderingId === String(job._id)}
                      onPress={() => void onRerender(job._id)}
                    >
                      <ButtonText>{rerenderingId === String(job._id) ? "Re-rendering..." : "Re-render video"}</ButtonText>
                    </Button>
                  ) : null}
                  {job.status === "cancelled" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={rerenderingId === String(job._id)}
                      onPress={() => void onRerender(job._id)}
                    >
                      <ButtonText>{rerenderingId === String(job._id) ? "Starting..." : "Render video"}</ButtonText>
                    </Button>
                  ) : null}
                  {job.error?.retryable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={retryingId === String(job._id)}
                      onPress={() => void onRetry(job._id)}
                    >
                      <ButtonText>{retryingId === String(job._id) ? "Retrying..." : "Retry render"}</ButtonText>
                    </Button>
                  ) : null}
                  {job.error ? (
                    <Text className="text-[11px] leading-4 text-destructive" numberOfLines={2} selectable>
                      {job.error.message}
                    </Text>
                  ) : !ready ? (
                    <Text className="text-[11px] text-muted-foreground">Available after render succeeds.</Text>
                  ) : null}
                </Box>
              </Box>
            );
          })}
        </Box>
      </ScrollView>
    </SurfaceCard>
  );
}

function RenderSummaryPill({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "neutral" | "warning" | "accent" | "danger";
}) {
  return count > 0 ? <StatusBadge label={label} tone={tone} /> : null;
}

function TableHeader({ children, className }: { children: string; className: string }) {
  return (
    <Text className={`text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground ${className}`}>
      {children}
    </Text>
  );
}

function RenderedVideoModal({
  video,
  url,
  loading,
  error,
  onSelectVariant,
  onClose,
}: {
  video: PreviewVideo | null;
  url: string | null;
  loading: boolean;
  error: string | null;
  onSelectVariant: (objectKey: string) => void;
  onClose: () => void;
}) {
  const variants = video ? renderedVideoVariants(video.output) : [];
  const selectedVariant = video ? selectedRenderedVideoVariant(video) : null;

  if (Platform.OS === "web" && video !== null) {
    return React.createElement(
      "div",
      {
        role: "dialog",
        "aria-modal": true,
        "aria-label": `Preview ${video.title}`,
        onClick: onClose,
        style: {
          position: "fixed",
          inset: 0,
          zIndex: 10000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0, 0, 0, 0.72)",
          padding: 24,
        },
      },
      React.createElement(
        "div",
        {
          onClick: (event: React.MouseEvent) => event.stopPropagation(),
          style: {
            width: "min(1040px, calc(100vw - 48px))",
            maxHeight: "calc(100vh - 48px)",
            overflow: "auto",
            borderRadius: 16,
            border: "1px solid rgba(255, 255, 255, 0.12)",
            background: "#11100E",
            boxShadow: "0 28px 80px rgba(0, 0, 0, 0.42)",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
              padding: "16px 20px",
            },
          },
          React.createElement(
            "div",
            { style: { minWidth: 0 } },
            React.createElement(
              "div",
              {
                style: {
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                },
              },
              video.title
            ),
            React.createElement(
              "div",
              {
                style: {
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "#A9A399",
                  fontSize: 12,
                  marginTop: 3,
                },
              },
              video.subtitle
            )
          ),
          React.createElement(
            "button",
            {
              type: "button",
              onClick: onClose,
              style: {
                border: 0,
                borderRadius: 999,
                background: "rgba(255, 255, 255, 0.1)",
                color: "#fff",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                padding: "9px 13px",
              },
            },
            "Close"
          )
        ),
          React.createElement(
            "div",
            { style: { padding: 20 } },
            variants.length > 1
              ? React.createElement(
                  "div",
                  {
                    style: {
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      marginBottom: 16,
                    },
                  },
                  variants.map((variant) =>
                    React.createElement(
                      "button",
                      {
                        key: variant.objectKey,
                        type: "button",
                        onClick: () => onSelectVariant(variant.objectKey),
                        style: {
                          border: 0,
                          borderRadius: 999,
                          background:
                            variant.objectKey === video.objectKey
                              ? "#FFFFFF"
                              : "rgba(255, 255, 255, 0.1)",
                          color:
                            variant.objectKey === video.objectKey ? "#11100E" : "#FFFFFF",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 700,
                          padding: "8px 11px",
                        },
                      },
                      `${variant.width}x${variant.height}`
                    )
                  )
                )
              : null,
            React.createElement(
              "div",
            {
              style: {
                overflow: "hidden",
                borderRadius: 14,
                background: "#000",
              },
            },
            loading
              ? React.createElement(
                  "div",
                  {
                    style: {
                      minHeight: 420,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#C7C1B7",
                      fontSize: 14,
                    },
                  },
                  "Loading secure preview..."
                )
              : error
                ? React.createElement(
                    "div",
                    {
                      style: {
                        minHeight: 320,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#FFB2A8",
                        fontSize: 14,
                        padding: 24,
                        textAlign: "center",
                      },
                    },
                    error
                  )
                : url
                  ? React.createElement("video", {
                      src: url,
                      controls: true,
                      autoPlay: true,
                      style: {
                        display: "block",
                        width: "100%",
                        maxHeight: "72vh",
                        backgroundColor: "#000",
                      },
                    })
                  : React.createElement(
                      "div",
                      {
                        style: {
                          minHeight: 320,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#C7C1B7",
                          fontSize: 14,
                        },
                      },
                      "Preparing preview..."
                    )
          ),
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 16,
              },
            },
            React.createElement(
              "div",
              null,
              React.createElement(
                "div",
                { style: { color: "#fff", fontSize: 12, fontWeight: 700 } },
                selectedVariant
                  ? `${formatDurationLong(selectedVariant.durationMs)} · ${selectedVariant.width}x${selectedVariant.height} · ${selectedVariant.fps}fps · ${formatBytes(selectedVariant.sizeBytes)}`
                  : ""
              ),
              React.createElement(
                "div",
                {
                  style: {
                    color: "#A9A399",
                    fontSize: 11,
                    marginTop: 3,
                    wordBreak: "break-all",
                  },
                },
                selectedVariant?.objectKey ?? ""
              )
            ),
            url
              ? React.createElement(
                  "a",
                  {
                    href: url,
                    target: "_blank",
                    rel: "noreferrer",
                    style: {
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.1)",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "10px 14px",
                      textDecoration: "none",
                    },
                  },
                  "Open in new tab"
                )
              : null
          )
        )
      )
    );
  }

  return (
    <Modal isOpen={video !== null} onClose={onClose} size="full">
      <ModalBackdrop />
      <ModalContent className="max-w-[1040px] rounded-[16px] bg-[#11100E] p-0">
        <ModalHeader className="border-b border-white/10 px-5 py-4">
          <Box className="min-w-0 flex-1 gap-1">
            <Text className="text-[15px] font-bold text-white" numberOfLines={1}>
              {video?.title ?? "Rendered video"}
            </Text>
            <Text className="text-[12px] text-[#A9A399]" numberOfLines={1}>
              {video?.subtitle ?? "Preview"}
            </Text>
          </Box>
          <ModalCloseButton onPress={onClose} className="rounded-full bg-white/10 px-3 py-2">
            <Text className="text-[12px] font-bold text-white">Close</Text>
          </ModalCloseButton>
        </ModalHeader>
        <ModalBody className="m-0 p-5">
          <Box className="gap-4">
            {variants.length > 1 ? (
              <Box className="flex-row flex-wrap gap-2">
                {variants.map((variant) => (
                  <Pressable
                    key={variant.objectKey}
                    className={`rounded-full px-3 py-2 ${variant.objectKey === video?.objectKey ? "bg-white" : "bg-white/10"}`}
                    onPress={() => onSelectVariant(variant.objectKey)}
                    accessibilityRole="button"
                    accessibilityLabel={`Preview ${variant.width} by ${variant.height} video rendition`}
                  >
                    <Text className={`text-[12px] font-bold ${variant.objectKey === video?.objectKey ? "text-[#11100E]" : "text-white"}`}>
                      {variant.width}x{variant.height}
                    </Text>
                  </Pressable>
                ))}
              </Box>
            ) : null}
            <Box className="overflow-hidden rounded-[14px] bg-black">
              {loading ? (
                <Box className="min-h-[420px] items-center justify-center">
                  <Text className="text-sm text-[#C7C1B7]">Loading secure preview...</Text>
                </Box>
              ) : error ? (
                <Box className="min-h-[320px] items-center justify-center px-6">
                  <Text className="text-center text-sm text-[#FFB2A8]">{error}</Text>
                </Box>
              ) : url && Platform.OS === "web" ? (
                React.createElement("video", {
                  src: url,
                  controls: true,
                  autoPlay: true,
                  style: {
                    display: "block",
                    width: "100%",
                    maxHeight: "72vh",
                    backgroundColor: "#000",
                  },
                })
              ) : url ? (
                <Box className="min-h-[260px] items-center justify-center px-6">
                  <Text className="text-center text-sm text-[#C7C1B7]">
                    Video preview is available in the browser. Use the signed link below to open it.
                  </Text>
                </Box>
              ) : (
                <Box className="min-h-[320px] items-center justify-center">
                  <Text className="text-sm text-[#C7C1B7]">Preparing preview...</Text>
                </Box>
              )}
            </Box>
            <Box className="flex-row flex-wrap items-center justify-between gap-3">
              <Box className="gap-0.5">
                <Text className="text-[12px] font-semibold text-white">
                  {selectedVariant
                    ? `${formatDurationLong(selectedVariant.durationMs)} · ${selectedVariant.width}x${selectedVariant.height} · ${selectedVariant.fps}fps · ${formatBytes(selectedVariant.sizeBytes)}`
                    : ""}
                </Text>
                <Text className="text-[11px] text-[#A9A399]" selectable>
                  {selectedVariant?.objectKey ?? ""}
                </Text>
              </Box>
              {url && Platform.OS === "web"
                ? React.createElement(
                    "a",
                    {
                      href: url,
                      target: "_blank",
                      rel: "noreferrer",
                      style: {
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.1)",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "10px 14px",
                        textDecoration: "none",
                      },
                    },
                    "Open in new tab"
                  )
                : null}
            </Box>
          </Box>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

function buildRenderUnitMeta(course: RunCourseRows | undefined): Map<string, RenderUnitMeta> {
  const map = new Map<string, RenderUnitMeta>();
  if (!course) return map;

  const moduleNumberByKey = new Map<string, number>();
  for (const unit of course.units) {
    if (!moduleNumberByKey.has(unit.moduleKey)) {
      moduleNumberByKey.set(unit.moduleKey, moduleNumberByKey.size + 1);
    }
    const order = unitOrder(unit);
    const moduleNumber = order ? order.module + 1 : moduleNumberByKey.get(unit.moduleKey) ?? null;
    const unitNumber = order ? order.unit + 1 : null;
    map.set(unit.unitKey, {
      moduleLabel: unit.moduleTitle?.trim() || readableModuleLabel(unit.moduleKey),
      moduleKey: unit.moduleKey,
      moduleNumber,
      unitLabel: readableUnitLabel(unit),
      unitKey: unit.unitKey,
      unitNumber,
    });
  }
  return map;
}

function fallbackRenderUnitMeta(job: RenderJob): RenderUnitMeta {
  const parsed = parseUnitPosition(job.unitId);
  const moduleNumber = parsed?.moduleNumber ?? parseModuleNumber(job.moduleId);
  return {
    moduleLabel: readableModuleLabel(job.moduleId),
    moduleKey: job.moduleId,
    moduleNumber,
    unitLabel: `Unit ${parsed?.unitNumber ?? job.unitIndex + 1}`,
    unitKey: job.unitId,
    unitNumber: parsed?.unitNumber ?? job.unitIndex + 1,
  };
}

function unitPositionLabel(meta: RenderUnitMeta, job: RenderJob): string {
  if (meta.moduleNumber !== null && meta.unitNumber !== null) {
    return `${meta.moduleNumber}.${meta.unitNumber}`;
  }
  const parsed = parseUnitPosition(job.unitId);
  if (parsed) return `${parsed.moduleNumber}.${parsed.unitNumber}`;
  return String(job.unitIndex + 1);
}

function modulePositionLabel(meta: RenderUnitMeta): string {
  return meta.moduleNumber !== null ? `Module ${meta.moduleNumber}` : "Module";
}

function parseUnitPosition(unitId: string): { moduleNumber: number; unitNumber: number } | null {
  return parseGeneratedUnitPosition(unitId);
}

function parseModuleNumber(moduleId: string): number | null {
  return parseGeneratedModuleNumber(moduleId);
}

function unitOrder(unit: Doc<"microUnits">): { module: number; unit: number } | null {
  const meta = unit.meta;
  if (!isRecord(meta) || !isRecord(meta.order)) return null;
  const module = meta.order.module;
  const unitIndex = meta.order.unit;
  if (typeof module !== "number" || typeof unitIndex !== "number") return null;
  return { module, unit: unitIndex };
}

function readableUnitLabel(unit: Doc<"microUnits">): string {
  const meta = unit.meta;
  if (isRecord(meta) && typeof meta.title === "string" && meta.title.trim().length > 0) {
    return meta.title.trim();
  }
  if (unit.concept.trim().length > 0) return readableIdentifier(unit.concept);
  return `Unit ${formatUnitPositionLabel(unit.unitKey, readableIdentifier(unit.unitKey))}`;
}

function readableModuleLabel(moduleKey: string): string {
  const readable = readableIdentifier(moduleKey);
  if (/^m\d+$/i.test(readable)) {
    return formatModuleNumberLabel(moduleKey, undefined, { includeWord: true });
  }
  return readable;
}

function readableIdentifier(value: string): string {
  return value
    .replace(/^[a-z]+[0-9]*-/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || value;
}

function renderStatusLabel(status: string): string {
  if (status === "succeeded") return "Ready";
  if (status === "rendering") return "Rendering";
  if (status === "dispatched") return "In renderer";
  if (status === "queued") return "Queued";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return readableIdentifier(status);
}

function renderStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "accent" {
  if (status === "succeeded") return "success";
  if (status === "failed") return "danger";
  if (status === "rendering") return "accent";
  if (status === "dispatched" || status === "queued") return "warning";
  return "neutral";
}

function formatDurationLong(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function PrimaryGenerationAction({ runId, state }: { runId: Id<"runs">; state: string }) {
  const href = actionHrefForState(runId, state);
  if (state === "PUBLISHED") {
    return <Text className="text-xs text-[#B7B4A9]">Published package frozen. Render status appears in the side rail.</Text>;
  }
  if (!href) return null;
  return (
    <Link href={href}>
      <Text className="text-sm font-semibold text-[#7FD3A0]">{actionLabelForState(state)}</Text>
    </Link>
  );
}

function phaseForState(state: string): { index: number; label: string } {
  const index = PHASES.findIndex((phase) => phase.states.includes(state));
  const safeIndex = index >= 0 ? index : 0;
  return { index: safeIndex, label: PHASES[safeIndex]?.label ?? PHASES[0]!.label };
}

function substepIndexForState(state: string): number {
  if (["UPLOADED", "CONVERTING"].includes(state)) return state === "UPLOADED" ? 0 : 1;
  if (["CONVERTED", "EXTRACTING", "EXTRACTED", "GATE_1_KNOWLEDGE_REVIEW"].includes(state)) return 2;
  if (["OUTLINING", "OUTLINE_REVIEW"].includes(state)) return state === "OUTLINING" ? 0 : 1;
  if (state === "COMPILING") return 0;
  if (["COMPILED", "QA_RUNNING", "QA_PASSED", "QA_FLAGGED"].includes(state)) return 1;
  if (["GATE_2_COURSE_REVIEW", "GATE_2_QUIZ_REVIEW"].includes(state)) return 2;
  if (state === "GENERATING_SCRIPT") return 0;
  if (state === "GENERATING_ASSETS") return 1;
  if (state === "GATE_3_PREVIEW") return 2;
  if (state === "PUBLISHING") return 0;
  if (state === "PUBLISHED") return 2;
  return 0;
}

function progressPercent(state: string, compileProgress: RunCompileProgress | null | undefined): number {
  const fixed: Record<string, number> = {
    UPLOADED: 3,
    CONVERTING: 8,
    CONVERTED: 13,
    EXTRACTING: 16,
    EXTRACTED: 19,
    GATE_1_KNOWLEDGE_REVIEW: 19,
    OUTLINING: 25,
    OUTLINE_REVIEW: 38,
    COMPILED: 55,
    QA_RUNNING: 61,
    QA_PASSED: 66,
    QA_FLAGGED: 66,
    GATE_2_COURSE_REVIEW: 69,
    GATE_2_QUIZ_REVIEW: 69,
    GENERATING_SCRIPT: 75,
    GENERATING_ASSETS: 83,
    GATE_3_PREVIEW: 89,
    PUBLISHING: 95,
    PUBLISHED: 100,
  };
  if (state === "COMPILING") {
    const compilePercent =
      typeof compileProgress?.progressPercent === "number"
        ? compileProgress.progressPercent
        : compileProgress?.totalUnits && compileProgress.totalUnits > 0
          ? (compileProgress.processedUnits / compileProgress.totalUnits) * 100
          : 0;
    return Math.round(40 + Math.max(0, Math.min(100, compilePercent)) * 0.15);
  }
  return fixed[state] ?? 0;
}

function phaseHeadline(state: string): string {
  const labels: Record<string, string> = {
    UPLOADED: "Preparing your source documents",
    CONVERTING: "Converting your source documents",
    CONVERTED: "Source documents converted",
    EXTRACTING: "Extracting the key facts from your sources",
    EXTRACTED: "Source facts are ready",
    GATE_1_KNOWLEDGE_REVIEW: "Source facts need your approval",
    OUTLINING: "Drafting your course outline",
    OUTLINE_REVIEW: "Your course outline is ready to review",
    COMPILING: "Building the course content",
    COMPILED: "Course content has been built",
    QA_RUNNING: "Checking course quality",
    QA_PASSED: "Quality checks passed",
    QA_FLAGGED: "Quality checks found items to review",
    GATE_2_COURSE_REVIEW: "Your full course is ready to review",
    GATE_2_QUIZ_REVIEW: "Your course questions are ready to review",
    GENERATING_SCRIPT: "Creating the course voice script",
    GENERATING_ASSETS: "Creating course media and preview",
    GATE_3_PREVIEW: "Your playable preview is ready",
    PUBLISHING: "Publishing your course",
    PUBLISHED: "Your course is published",
  };
  return labels[state] ?? friendlyState(state);
}

function phaseDescription(state: string, progress: RunCompileProgress | null | undefined): string {
  if (state === "COMPILING") {
    const units = progress?.totalUnits
      ? `${progress.processedUnits} of ${progress.totalUnits} units authored`
      : `${progress?.processedUnits ?? 0} units authored`;
    const eta = typeof progress?.etaMs === "number" && progress.etaMs > 0 ? ` · about ${formatEta(progress.etaMs)} remaining` : "";
    return `${units}${eta}.`;
  }
  if (GATE_STATES.has(state)) return "Generation is paused here until you review and approve this stage.";
  if (state === "PUBLISHED") return "The published package is frozen and rendered outputs are tracked below.";
  return "This page updates live as the course moves through the generation pipeline.";
}

function actionHrefForState(runId: Id<"runs"> | null, state: string): string | null {
  if (!runId) return null;
  if (state === "OUTLINE_REVIEW") return `/admin/runs/${runId}/outline`;
  if (["GATE_2_COURSE_REVIEW", "GATE_2_QUIZ_REVIEW"].includes(state)) return `/admin/runs/${runId}/gate-2`;
  if (state === "GATE_3_PREVIEW") return `/admin/runs/${runId}/gate-3`;
  return null;
}

function actionLabelForState(state: string): string {
  if (state === "OUTLINE_REVIEW") return "Review outline";
  if (["GATE_2_COURSE_REVIEW", "GATE_2_QUIZ_REVIEW"].includes(state)) return "Review full course";
  if (state === "GATE_3_PREVIEW") return "Review playable preview";
  return "Open current stage";
}

function headerStatusLabel(state: string): string {
  if (state === "PUBLISHED") return "Published";
  if (state === "FAILED") return "Stopped";
  if (GATE_STATES.has(state)) return "Paused for your approval";
  return "In progress";
}

function compactStatusLabel(state: string): string {
  if (state === "PUBLISHED") return "Published";
  if (state === "FAILED") return "Stopped";
  if (GATE_STATES.has(state)) return "Paused";
  return "Live";
}

function headerStatusTone(state: string): "neutral" | "success" | "warning" | "danger" | "accent" {
  if (state === "PUBLISHED") return "success";
  if (state === "FAILED") return "danger";
  if (GATE_STATES.has(state)) return "warning";
  return "accent";
}

function approvalHeadlineForState(state: string): string {
  if (state === "OUTLINE_REVIEW") return "Approve the outline to start course writing";
  if (["GATE_2_COURSE_REVIEW", "GATE_2_QUIZ_REVIEW"].includes(state)) {
    return "Approve the full course to keep building";
  }
  if (state === "GATE_3_PREVIEW") return "Approve the preview to publish";
  return phaseHeadline(state);
}

function primaryCtaForState(state: string): string {
  if (state === "OUTLINE_REVIEW") return "Review & approve outline";
  if (state === "GATE_3_PREVIEW") return "Review & approve preview";
  return "Review & approve";
}

function metricLabel(value: number | null, noun: string): string {
  if (typeof value !== "number") return `${capitalize(noun)}s pending`;
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function buildOperatorDetail(
  run: Doc<"runs">,
  event: RunEvent | undefined,
  failure: { summary: string; technical?: string }
): string {
  return [
    `phase  ${phaseForState(event?.fromState ?? "").label}`,
    `state  ${event?.fromState ?? "unknown"} -> FAILED`,
    `error  ${failure.summary}`,
    run.error?.cause ? `detail ${run.error.cause}` : failure.technical ? `detail ${failure.technical}` : null,
    event?.detail ? `event  ${event.detail}` : null,
    `run    ${run._id}`,
    `at     ${new Date(event?._creationTime ?? run._creationTime).toISOString()}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function eventTitle(event: RunEvent): string {
  if (event.toState === "FAILED") return `${phaseForState(event.fromState).label} failed`;
  if (GATE_STATES.has(event.toState)) return `${phaseForState(event.toState).label} ready for approval`;
  if (event.toState === "PUBLISHED") return "Course published";
  return `${friendlyState(event.toState)} started`;
}

function docTitle(doc: Doc<"sourceDocs">): string {
  const tail = doc.objectKey.split("/").at(-1) ?? doc.objectKey;
  if (!doc.objectKey.startsWith("sha256/")) return tail;
  const hash = (doc.sourceDocHash ?? doc.objectKey).replace("sha256/", "").slice(0, 10);
  return `Source-${hash}.${doc.kind.toLowerCase()}`;
}

function friendlyState(state: string): string {
  if (state === "OUTLINE_REVIEW") return "outline approval";
  if (state === "GATE_2_COURSE_REVIEW") return "course approval";
  if (state === "GATE_3_PREVIEW") return "preview approval";
  if (state === "GENERATING_SCRIPT") return "script generation";
  if (state === "GENERATING_ASSETS") return "asset generation";
  return state.replaceAll("_", " ").toLowerCase();
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatEventTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function displayActor(actor: string | undefined): string {
  if (!actor) return "Admin";
  if (actor === "system") return "System";
  return actor
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join(".") || actor;
}

function shortRunId(runId: Id<"runs">): string {
  const value = String(runId);
  return value.length > 14 ? value.slice(-14) : value;
}

function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatEta(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function StatRow({ label, value, success }: { label: string; value: string; success?: boolean }) {
  return (
    <Box className="flex-row items-center justify-between gap-3">
      <Text className="text-[13px] text-secondary-foreground">{label}</Text>
      <Text className={`text-[13px] font-semibold ${success ? "text-success-muted-foreground" : "text-foreground"}`}>
        {value}
      </Text>
    </Box>
  );
}

function buildFailureGuidance(cause: string | undefined): string[] {
  const tips: string[] = [];
  const normalized = (cause ?? "").toLowerCase();
  if (normalized.includes("converter_url") || normalized.includes("callback_secret")) {
    tips.push("Set CONVERTER_URL and CONVERTER_CALLBACK_SECRET for this deployment.");
  }
  if (normalized.includes("dispatch failed")) {
    tips.push("Check converter service health and object-store connectivity.");
  }
  if (normalized.includes("no conversion callback") || normalized.includes("timed out")) {
    tips.push("Verify the converter callback URL and HMAC secret match the Convex settings.");
  }
  if (normalized.includes("callback rejected")) {
    tips.push("Inspect converter logs for malformed page output in the rejected manifest.");
  }
  if (normalized.includes("structured output failed validation")) {
    tips.push("The model returned malformed structured output. Resume to retry the failed step while keeping earlier work.");
  }
  if (normalized.includes("enterat.word") || normalized.includes("not a substring of narration")) {
    tips.push("A card timing anchor did not match its narration. Resume to run the repaired step again.");
  }
  if (normalized.includes("prompt is too long") || normalized.includes("input is too long for requested model")) {
    tips.push("The quality-check input exceeded the model context window. Reduce course scope before resuming if the issue repeats.");
  }
  if (tips.length === 0) {
    tips.push("Open the full logs to see the exact state, event detail, and operator message.");
    tips.push("Fix the reported root cause, then Resume to retry from where the generation stopped.");
  }
  return tips;
}

function describeFailureCause(cause: string | undefined): { summary: string; technical?: string } {
  const raw = (cause ?? "").trim();
  if (!raw) return { summary: "The pipeline did not report a specific failure cause." };
  const anchorMatch = raw.match(/enterAt\.word "([^"]+)"[\s\S]*narration "([^"]+)"[\s\S]*unit "([^"]+)"/);
  if (anchorMatch) {
    return {
      summary: `A card timing anchor in ${anchorMatch[3]} did not match its narration.`,
      technical: compactTechnical(raw),
    };
  }
  const promptTooLongMatch = raw.match(/prompt is too long:\s*([0-9,]+)\s*tokens\s*>\s*([0-9,]+)\s*maximum/i);
  if (promptTooLongMatch) {
    return {
      summary: `The quality-check request exceeded the model context window (${promptTooLongMatch[1]} > ${promptTooLongMatch[2]} tokens).`,
      technical: compactTechnical(raw),
    };
  }
  if (raw.toLowerCase().includes("input is too long for requested model")) {
    return {
      summary: "The quality-check request exceeded the model context window.",
      technical: compactTechnical(raw),
    };
  }
  const structuredFailure = raw.match(/structured output failed validation after retry \(task ([^)]+)\)/i);
  if (structuredFailure) {
    return {
      summary: `${structuredFailure[1]} returned malformed structured output after retries.`,
      technical: compactTechnical(raw),
    };
  }
  if (raw.toLowerCase().startsWith("openrouter")) {
    const unescaped = raw.replace(/\\"/g, '"');
    const providerMessages = [...unescaped.matchAll(/"message":"([^"]+)"/g)]
      .map((match) => match[1])
      .filter((message) => message && message !== "Provider returned error");
    return {
      summary: providerMessages[0]
        ? `The model provider rejected the request: ${providerMessages[0]}`
        : "The model provider rejected the request.",
      technical: compactTechnical(raw),
    };
  }
  return {
    summary: "The current generation step did not finish. Open the full logs for the operator detail.",
    technical: compactTechnical(raw),
  };
}

function compactTechnical(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length > 300 ? `${oneLine.slice(0, 297)}...` : oneLine;
}
