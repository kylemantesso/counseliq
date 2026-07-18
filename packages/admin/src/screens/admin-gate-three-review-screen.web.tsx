"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "solito/navigation";
import type { UnitScript, UnitTiming } from "@counseliq/course-schema";
import {
  Box,
  Button,
  ButtonText,
  Text,
} from "@counseliq/ui";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
import { CoursePlayer } from "../components/course-player/course-player";
import { formatMs } from "../components/course-player/timeline-helpers";
import {
  VoiceStudioModal,
  type CourseTtsVoice,
} from "../components/voice-studio-modal";
import type {
  PreviewCard,
  PreviewNarrationSentence,
  PreviewQuestion,
  PreviewUnit,
  PreviewUnitState,
  RunPreviewData,
} from "../components/course-player/types";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";
import { formatUnitPositionLabel } from "../format/unit-labels";

/**
 * Step 3 — the playable preview studio. The course player fills the main
 * pane (module rail, phase pills, audio-driven cards); above it sit the
 * approve/reject actions and a blocked/failed warning banner.
 * The right rail inside the studio holds always-on narration + beat editing.
 */
export function AdminGateThreeReviewScreen() {
  return (
    <AdminGuard>
      <AdminGateThreeReviewContent />
    </AdminGuard>
  );
}

// --- payload → player view-model -------------------------------------------

type PreviewPayload = NonNullable<
  ReturnType<typeof useQuery<typeof api.pipeline.tts.preview.adminGetRunPreview>>
>;

type PayloadUnit = PreviewPayload["modules"][number]["units"][number];

function runStepLabel(state: string): string {
  if (state === "OUTLINE_REVIEW") return "Outline approval";
  if (state === "GATE_2_COURSE_REVIEW") return "Step 2 - course review";
  if (state === "GATE_3_PREVIEW") return "Step 3 - preview and publish";
  return state;
}

function toPreviewUnit(u: PayloadUnit): PreviewUnit {
  return {
    id: String(u._id),
    unitKey: u.unitKey,
    concept: u.concept,
    state: u.state as PreviewUnitState,
    error: (u.error as PreviewUnit["error"]) ?? null,
    narration: (u.narration as PreviewNarrationSentence[]) ?? [],
    cards: (u.cards as PreviewCard[]) ?? [],
    meta: (u.meta as PreviewUnit["meta"]) ?? {},
    script: (u.script as UnitScript | null) ?? null,
    timing: (u.timing as UnitTiming | null) ?? null,
    avatarTrack: (u.avatarTrack as PreviewUnit["avatarTrack"]) ?? null,
  };
}

function toRunPreviewData(preview: PreviewPayload, runId: string): RunPreviewData {
  return {
    runId,
    runState: preview.run.state,
    course: {
      title: preview.course.title,
      version: preview.course.version,
      brandRef: preview.course.brandRef ?? null,
    },
    institution: {
      name: preview.institution?.name ?? "CounselIQ",
      brandTokens: preview.institution?.brandTokens,
    },
    modules: preview.modules.map((m) => ({
      moduleKey: m.moduleKey,
      moduleTitle: m.moduleTitle,
      units: m.units.map(toPreviewUnit),
    })),
    questions: preview.questions.map((q) => q.body as PreviewQuestion),
    assets: preview.assets as RunPreviewData["assets"],
    summary: {
      ready: preview.summary.ready,
      blocked: preview.summary.blocked,
      failed: preview.summary.failed,
      totalDurationMs: preview.summary.totalDurationMs,
    },
  };
}

function unitCharacters(script: UnitScript | null | undefined): number {
  if (!script) return 0;
  return script.sentences.reduce((sum, s) => sum + s.speakText.length, 0);
}

function unitBlockedTerms(script: UnitScript | null | undefined): string[] {
  if (!script) return [];
  const terms = new Set<string>();
  for (const sentence of script.sentences) {
    for (const term of sentence.blockedTerms) terms.add(term);
  }
  return [...terms];
}

function downloadFile(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function narrationFilename(courseTitle: string, unitKey: string) {
  const stem = `${courseTitle}-${unitKey}-narration`
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem || "narration"}.mp3`;
}

// --- screen -----------------------------------------------------------------

function AdminGateThreeReviewContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const runId = params?.id as Id<"runs"> | undefined;

  const preview = useQuery(
    api.pipeline.tts.preview.adminGetRunPreview,
    runId ? { runId } : "skip"
  );
  const avatarJobs = useQuery(
    api.pipeline.avatar.jobs.listAvatarJobsForRun,
    runId ? { runId } : "skip"
  );
  const decideGate = useMutation(api.pipeline.runs.adminDecideGate);
  const updateSentence = useMutation(
    api.pipeline.tts.edit.adminUpdateNarrationSentence
  );
  const updateCardEnterAtWord = useMutation(
    api.pipeline.tts.edit.adminUpdateCardEnterAtWord
  );
  const retryUnit = useMutation(api.pipeline.tts.edit.adminRetryUnitTts);
  const regenerateUnit = useMutation(api.pipeline.tts.edit.adminRegenerateUnitTts);
  const regenerateRun = useMutation(api.pipeline.tts.edit.adminRegenerateRunTts);
  const retryAvatarJob = useMutation(api.pipeline.avatar.jobs.adminRetryAvatarJob);
  const presignBatch = useAction(api.pipeline.objectStore.adminPresignGetBatch);
  const presignDownloadBatch = useAction(
    api.pipeline.objectStore.adminPresignDownloadBatch
  );

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [voiceStudioOpen, setVoiceStudioOpen] = useState(false);
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  const [downloadingNarration, setDownloadingNarration] = useState(false);
  const [activeUnitId, setActiveUnitId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<{
    unitId: string;
    narrationId: string | null;
  } | null>(null);

  // audioKey → presigned URL. Every key handed to requestUrls is re-presigned
  // (the player only asks for keys it lacks, or keys whose URL just errored —
  // so an incoming known key means TTL expiry and must be refreshed).
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const inFlight = useRef<Set<string>>(new Set());
  const requestUrls = useCallback(
    (audioKeys: string[]) => {
      const keys = audioKeys.filter((k) => !inFlight.current.has(k));
      if (keys.length === 0) return;
      for (const k of keys) inFlight.current.add(k);
      presignBatch({ keys })
        .then((results) => {
          setUrls((current) => {
            const next = new Map(current);
            for (const { key, url } of results) next.set(key, url);
            return next;
          });
        })
        .catch((err) => {
          setError(
            getUserFacingErrorMessage(err, "Could not load audio. Try again.")
          );
        })
        .finally(() => {
          for (const k of keys) inFlight.current.delete(k);
        });
    },
    [presignBatch]
  );

  // unitId → regeneration start time; cleared when newer timing arrives, the
  // unit blocks, or a post-start failure comes back from synthesis.
  const [resynth, setResynth] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!preview || resynth.size === 0) return;
    const done: string[] = [];
    for (const module of preview.modules) {
      for (const unit of module.units) {
        const prev = resynth.get(String(unit._id));
        if (prev === undefined) continue;
        const timing = unit.timing as UnitTiming | null;
        if (timing && timing.generatedAt > prev) done.push(String(unit._id));
        // An edit that blocked the unit never re-synthesises; stop waiting.
        if (unit.state === "blocked") done.push(String(unit._id));
        if (unit.error && Date.now() - prev > 1500) done.push(String(unit._id));
      }
    }
    if (done.length > 0) {
      setResynth((current) => {
        const next = new Map(current);
        for (const id of done) next.delete(id);
        return next;
      });
    }
  }, [preview, resynth]);

  const data = useMemo(
    () => (preview && runId ? toRunPreviewData(preview, runId) : null),
    [preview, runId]
  );

  const allUnits = useMemo(
    () => (preview ? preview.modules.flatMap((m) => m.units) : []),
    [preview]
  );
  const currentVoice =
    (preview?.course.ttsVoice as CourseTtsVoice | null | undefined) ?? null;

  useEffect(() => {
    if (allUnits.length === 0) {
      if (activeUnitId !== null) setActiveUnitId(null);
      return;
    }
    if (
      activeUnitId === null ||
      !allUnits.some((unit) => String(unit._id) === activeUnitId)
    ) {
      setActiveUnitId(String(allUnits[0]._id));
    }
  }, [allUnits, activeUnitId]);

  const atGate = preview?.run.state === "GATE_3_PREVIEW";
  useEffect(() => {
    if (!atGate) setRejecting(false);
  }, [atGate]);

  if (preview === undefined) {
    return (
      <AdminWorkspaceFrame activeNav="runs" title="Step 3 — preview & publish">
        <Box className="p-6">
          <Text>Loading...</Text>
        </Box>
      </AdminWorkspaceFrame>
    );
  }
  if (preview === null || !runId || !data) {
    return (
      <AdminWorkspaceFrame activeNav="runs" title="Step 3 — preview & publish">
        <Box className="p-6">
          <Text className="text-muted-foreground">
            Run not found, or it has no compiled course yet.
          </Text>
        </Box>
      </AdminWorkspaceFrame>
    );
  }

  const blockedUnits = allUnits.filter((u) => u.state === "blocked");
  const failedUnits = allUnits.filter((u) => u.error);
  const approveBlockedReason = !atGate
    ? `Run is at ${runStepLabel(preview.run.state)}, not step 3 preview.`
    : null;

  const onApprove = async () => {
    if (!atGate) return;
    setError(null);
    setBusy(true);
    try {
      await decideGate({ runId, gate: 3, decision: "approve" });
    } catch (err) {
      setError(
        getUserFacingErrorMessage(err, "Review decision failed. Try again.")
      );
    } finally {
      setBusy(false);
    }
  };

  const onReject = async () => {
    if (!atGate) return;
    const notes = rejectNotes.trim();
    if (!notes) return;
    setError(null);
    setBusy(true);
    try {
      await decideGate({ runId, gate: 3, decision: "reject", notes });
      setRejecting(false);
      setRejectNotes("");
      router.push(`/admin/runs/${runId}/gate-2`);
    } catch (err) {
      setError(
        getUserFacingErrorMessage(err, "Review decision failed. Try again.")
      );
    } finally {
      setBusy(false);
    }
  };

  const onRetryUnit = async (unitId: Id<"microUnits">) => {
    if (!atGate) return;
    const startedAt = Date.now() - 1;
    setError(null);
    try {
      await retryUnit({ runId, unitId });
      setResynth((current) => new Map(current).set(String(unitId), startedAt));
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Retry failed. Try again."));
    }
  };

  const onRegenerateUnit = async (unitId: Id<"microUnits">) => {
    if (!atGate) return;
    const startedAt = Date.now() - 1;
    setError(null);
    try {
      await regenerateUnit({ runId, unitId });
      setResynth((current) => new Map(current).set(String(unitId), startedAt));
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Regenerate failed. Try again."));
    }
  };

  const onRegenerateAll = async () => {
    if (!atGate) return;
    const startedAt = Date.now() - 1;
    setError(null);
    setRegeneratingAll(true);
    try {
      const result = await regenerateRun({ runId });
      setResynth((current) => {
        const next = new Map(current);
        for (const unitId of result.unitIds) next.set(String(unitId), startedAt);
        return next;
      });
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Regenerate all failed. Try again."));
    } finally {
      setRegeneratingAll(false);
    }
  };

  const onDownloadNarration = async (unit: PreviewUnit) => {
    const audioKey = unit.timing?.unitAudioKey;
    if (!audioKey) {
      setError("No synthesized narration is available for this unit yet.");
      return;
    }

    setError(null);
    setDownloadingNarration(true);
    try {
      const downloads = await presignDownloadBatch({
        items: [{
          key: audioKey,
          filename: narrationFilename(preview.course.title, unit.unitKey),
        }],
      });
      for (const download of downloads) {
        downloadFile(download.url, download.filename);
      }
    } catch (err) {
      setError(
        getUserFacingErrorMessage(err, "Could not prepare narration downloads. Try again.")
      );
    } finally {
      setDownloadingNarration(false);
    }
  };

  const activeUnit =
    activeUnitId === null
      ? allUnits[0] ?? null
      : allUnits.find((unit) => String(unit._id) === activeUnitId) ?? null;

  const focusedNarrationId =
    focusTarget && activeUnit && focusTarget.unitId === String(activeUnit._id)
      ? focusTarget.narrationId
      : null;

  const auditionText =
    ((activeUnit?.narration ?? allUnits[0]?.narration ?? []) as PreviewNarrationSentence[])[0]
      ?.text ?? "";
  const voiceLabel = currentVoice?.name
    ? `${currentVoice.name}${currentVoice.accent && currentVoice.accent !== "all" ? ` · ${currentVoice.accent}` : ""}`
    : "No voice set";

  const rejectPanel = rejecting ? (
    <div
      style={{
        borderTop: "1px solid #202833",
        background: "#0c1218",
        padding: "14px 22px 16px",
      }}
    >
      <Text className="text-sm font-semibold" style={{ color: "#f2efe8" }}>
        Reject and send back to step 2 (course review)
      </Text>
      <textarea
        value={rejectNotes}
        onChange={(e) => setRejectNotes(e.target.value)}
        placeholder="Reviewer notes (required) - what must change before this course can publish?"
        rows={3}
        style={{
          width: "100%",
          resize: "vertical",
          marginTop: 10,
          borderRadius: 10,
          border: "1px solid #303946",
          background: "#080d12",
          color: "#f2efe8",
          padding: 12,
          fontSize: 13,
          fontFamily: "inherit",
          outline: "none",
        }}
      />
      <Box className="mt-3 flex-row gap-2">
        <Button
          size="sm"
          onPress={onReject}
          isDisabled={!atGate || busy || rejectNotes.trim().length === 0}
          className="bg-[#d6ad2f] data-[hover=true]:bg-[#cba126] data-[active=true]:bg-[#cba126]"
        >
          <ButtonText className="text-[#101419]">
            Confirm reject
          </ButtonText>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onPress={() => setRejecting(false)}
          className="border-[#303946] bg-[#111820]"
        >
          <ButtonText className="text-[#f2efe8]">Cancel</ButtonText>
        </Button>
      </Box>
    </div>
  ) : null;

  const warningPanel = blockedUnits.length > 0 || failedUnits.length > 0 ? (
    <div
      style={{
        borderTop: "1px solid #35232a",
        background: "rgba(126, 35, 35, .16)",
        padding: "12px 22px",
      }}
    >
      <Text className="text-sm font-semibold" style={{ color: "#ff8c8c" }}>
        Publishing warning
      </Text>
      <Box className="mt-2 gap-2">
        {blockedUnits.map((unit) => (
          <Box key={String(unit._id)} className="flex-row flex-wrap items-center gap-2">
            <Chip label="BLOCKED" tone="bad" />
            <Text className="text-sm font-semibold" style={{ color: "#f2efe8" }}>{formatUnitPositionLabel(unit.unitKey)}</Text>
            <Text className="text-sm" style={{ color: "#8f98a4" }}>{unit.concept}</Text>
            <Text className="text-sm" style={{ color: "#ff8c8c" }}>
              Unconfirmed pronunciation: {unitBlockedTerms(unit.script as UnitScript | null).join(", ") || "(see lexicon)"}
            </Text>
          </Box>
        ))}
        {failedUnits.map((unit) => (
          <Box key={String(unit._id)} className="flex-row flex-wrap items-center gap-2">
            <Chip label="FAILED" tone="bad" />
            <Text className="text-sm font-semibold" style={{ color: "#f2efe8" }}>{formatUnitPositionLabel(unit.unitKey)}</Text>
            <Text className="text-sm" style={{ color: "#ff8c8c" }}>
              {(unit.error?.cause ?? "synthesis failed").slice(0, 140)}
            </Text>
            {resynth.has(String(unit._id)) ? (
              <Chip label="re-synthesising" tone="accent" />
            ) : (
              <Button
                variant="outline"
                size="sm"
                onPress={() => onRetryUnit(unit._id)}
                isDisabled={!atGate}
                className="border-[#303946] bg-[#111820]"
              >
                <ButtonText className="text-[#f2efe8]">Retry</ButtonText>
              </Button>
            )}
          </Box>
        ))}
      </Box>
    </div>
  ) : null;
  const avatarFailurePanel = (avatarJobs ?? []).filter((job) => job.status === "failed").length > 0 ? (
    <div style={{ borderTop: "1px solid #35232a", background: "rgba(126,35,35,.16)", padding: "12px 22px" }}>
      <Text className="text-sm font-semibold" style={{ color: "#ff8c8c" }}>Avatar video warning</Text>
      <Box className="mt-2 gap-2">
        {(avatarJobs ?? []).filter((job) => job.status === "failed").map((job) => (
          <Box key={String(job._id)} className="flex-row flex-wrap items-center gap-2">
            <Chip label="AVATAR FAILED" tone="bad" />
            <Text className="text-sm" style={{ color: "#ff8c8c" }}>
              {job.error?.code === "insufficient_credit"
                ? "HeyGen credits are required before this video can be generated."
                : job.error?.code === "avatar_not_found"
                  ? "The selected avatar look is unavailable. Retry to use a compatible fallback look."
                : "HeyGen could not generate this avatar video. Retry after resolving the provider issue."}
            </Text>
            <Button
              variant="outline"
              size="sm"
              onPress={() => void retryAvatarJob({ jobId: job._id })}
              isDisabled={!atGate}
              className="border-[#303946] bg-[#111820]"
            >
              <ButtonText className="text-[#f2efe8]">Retry avatar</ButtonText>
            </Button>
          </Box>
        ))}
      </Box>
    </div>
  ) : null;

  return (
    <AdminWorkspaceFrame
      activeNav="runs"
      title="Step 3 - preview & publish"
      topbarTrail={["All runs", preview.course.title]}
      showPageHeader={false}
      contentClassName="flex-1 min-h-0 bg-[#090d12]"
      contentStyle={{ overflow: "hidden" }}
    >
      <Box className="flex-1 min-h-0">
        <CoursePlayer
          data={data}
          presignedUrls={urls}
          onRequestUrls={requestUrls}
          onDownloadNarration={onDownloadNarration}
          downloadingNarration={downloadingNarration}
          studioHeader={
            <GateThreeStudioHeader
              courseTitle={preview.course.title}
              meta={`CDU · voice ${voiceLabel} · ${preview.summary.totalCharacters.toLocaleString()} chars`}
              stateLabel={runStepLabel(preview.run.state)}
              atGate={atGate}
              readyLabel={`${preview.summary.ready}/${preview.summary.total} ready`}
              durationLabel={formatMs(preview.summary.totalDurationMs)}
              blockedCount={preview.summary.blocked}
              failedCount={preview.summary.failed}
              busy={busy}
              approveBlockedReason={approveBlockedReason}
              voiceLabel={voiceLabel}
              regeneratingAll={regeneratingAll}
              onOpenVoice={() => setVoiceStudioOpen(true)}
              onRegenerateAll={onRegenerateAll}
              onToggleReject={() => setRejecting((r) => !r)}
              onApprove={onApprove}
            >
              {error ? (
                <div style={{ borderTop: "1px solid #35232a", background: "rgba(126,35,35,.16)", padding: "10px 22px" }}>
                  <Text className="text-sm" style={{ color: "#ff8c8c" }}>{error}</Text>
                </div>
              ) : null}
              {rejectPanel}
              {warningPanel}
              {avatarFailurePanel}
            </GateThreeStudioHeader>
          }
          onActiveUnitChange={setActiveUnitId}
          onEditSentence={(unitId, narrationId) => {
            if (!atGate) return;
            setActiveUnitId(unitId);
            setFocusTarget({ unitId, narrationId });
          }}
          rightRail={
            <PreviewEditorRail
              runId={runId}
              unit={activeUnit}
              focusNarrationId={focusedNarrationId}
              resynthesizing={
                activeUnit ? resynth.has(String(activeUnit._id)) : false
              }
              editable={atGate}
              onSaved={(unitId, prevGeneratedAt, status) => {
                if (status === "resynthesizing") {
                  setResynth((current) =>
                    new Map(current).set(unitId, prevGeneratedAt)
                  );
                }
              }}
              onRetry={onRetryUnit}
              onRegenerate={onRegenerateUnit}
              updateSentence={updateSentence}
              updateCardEnterAtWord={updateCardEnterAtWord}
            />
          }
        />
        <VoiceStudioModal
          isOpen={voiceStudioOpen}
          runId={runId}
          auditionText={auditionText}
          currentVoice={currentVoice}
          onClose={() => setVoiceStudioOpen(false)}
          onError={setError}
        />
      </Box>
    </AdminWorkspaceFrame>
  );
}

// --- pieces -----------------------------------------------------------------

function GateThreeStudioHeader({
  courseTitle,
  meta,
  stateLabel,
  atGate,
  readyLabel,
  durationLabel,
  blockedCount,
  failedCount,
  busy,
  approveBlockedReason,
  voiceLabel,
  regeneratingAll,
  onOpenVoice,
  onRegenerateAll,
  onToggleReject,
  onApprove,
  children,
}: {
  courseTitle: string;
  meta: string;
  stateLabel: string;
  atGate: boolean;
  readyLabel: string;
  durationLabel: string;
  blockedCount: number;
  failedCount: number;
  busy: boolean;
  approveBlockedReason: string | null;
  voiceLabel: string;
  regeneratingAll: boolean;
  onOpenVoice: () => void;
  onRegenerateAll: () => void;
  onToggleReject: () => void;
  onApprove: () => void;
  children?: ReactNode;
}) {
  return (
    <div style={{ borderBottom: "1px solid #202833", background: "#090d12" }}>
      <div
        style={{
          minHeight: 62,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
          padding: "12px 22px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              color: "#d6ad2f",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: ".18em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Step 3 / 3 - Preview & publish
          </div>
          <div style={{ width: 1, height: 22, background: "#26303c" }} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minWidth: 0,
                color: "#f4f1e8",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {courseTitle}
              </span>
              <span style={{ color: "#53606d" }}>·</span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "#818b98",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                {meta}
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
          <Chip label={stateLabel} tone={atGate ? "accent" : "muted"} />
          <Chip label={readyLabel} tone={readyLabel.startsWith("0/") ? "muted" : "ok"} />
          {blockedCount > 0 ? <Chip label={`${blockedCount} blocked`} tone="bad" /> : null}
          {failedCount > 0 ? <Chip label={`${failedCount} failed`} tone="bad" /> : null}
          <Chip label={durationLabel} tone="muted" />
          <Button
            variant="outline"
            size="sm"
            onPress={onOpenVoice}
            isDisabled={busy || !atGate}
            className="border-[#303946] bg-[#111820]"
          >
            <ButtonText className="text-[#f4f1e8]">Voice: {voiceLabel}</ButtonText>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onPress={onRegenerateAll}
            isDisabled={busy || !atGate || regeneratingAll}
            className="border-[#77611f] bg-[#17150d]"
          >
            <ButtonText className="text-[#d6ad2f]">
              {regeneratingAll ? "Regenerating..." : "Regenerate all audio"}
            </ButtonText>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onPress={onToggleReject}
            isDisabled={busy || !atGate}
            className="border-[#303946] bg-[#111820]"
          >
            <ButtonText className="text-[#f4f1e8]">Reject to step 2</ButtonText>
          </Button>
          <div title={approveBlockedReason ?? "Publish this course"}>
            <Button
              size="sm"
              onPress={onApprove}
              isDisabled={busy || !atGate}
              className="bg-[#54d486] data-[hover=true]:bg-[#48c978] data-[active=true]:bg-[#48c978]"
            >
              <ButtonText className="font-bold text-[#07110b]">Approve &amp; publish</ButtonText>
            </Button>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "bad" | "accent" | "muted";
}) {
  const palette: Record<string, { border: string; color: string; bg: string }> = {
    ok: { border: "#215b39", color: "#62d991", bg: "rgba(36, 127, 75, .22)" },
    bad: { border: "#6c2d32", color: "#ff8c8c", bg: "rgba(126, 35, 35, .18)" },
    accent: { border: "#77611f", color: "#d6ad2f", bg: "rgba(214, 173, 47, .13)" },
    muted: { border: "#2f3945", color: "#8a94a1", bg: "#111820" },
  };
  const { border, color, bg } = palette[tone];
  return (
    <span
      style={{
        border: `1px solid ${border}`,
        color,
        background: bg,
        borderRadius: 999,
        padding: "4px 10px",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function anchorWordCandidates(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9$'-]+/g) ?? [];
  const unique = new Set<string>();
  for (const entry of matches) {
    const word = entry.trim();
    if (!word) continue;
    unique.add(word);
    if (unique.size >= 18) break;
  }
  return [...unique];
}

function cardDisplayName(template: string): string {
  return template
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Step 3 right rail — always-open narration + beat editor. */
function PreviewEditorRail({
  runId,
  unit,
  focusNarrationId,
  resynthesizing,
  editable,
  onSaved,
  onRetry,
  onRegenerate,
  updateSentence,
  updateCardEnterAtWord,
}: {
  runId: Id<"runs">;
  unit:
    | {
        _id: Id<"microUnits">;
        unitKey: string;
        narration: unknown;
        cards: unknown;
        script: unknown;
        timing: unknown;
        state: string;
        error?: { retryable: boolean; cause: string } | null;
      }
    | null;
  focusNarrationId: string | null;
  resynthesizing: boolean;
  editable: boolean;
  onSaved: (
    unitId: string,
    prevGeneratedAt: number,
    status: "updated" | "blocked" | "resynthesizing"
  ) => void;
  onRetry: (unitId: Id<"microUnits">) => void;
  onRegenerate: (unitId: Id<"microUnits">) => void;
  updateSentence: (args: {
    runId: Id<"runs">;
    unitId: Id<"microUnits">;
    narrationId: string;
    text: string;
  }) => Promise<{ status: "updated" | "blocked" | "resynthesizing" }>;
  updateCardEnterAtWord: (args: {
    runId: Id<"runs">;
    unitId: Id<"microUnits">;
    cardIndex: number;
    word: string;
  }) => Promise<{ status: "updated" }>;
}) {
  const sentences = ((unit?.narration ?? []) as PreviewNarrationSentence[]) ?? [];
  const cards = ((unit?.cards ?? []) as PreviewCard[]) ?? [];
  const timing = (unit?.timing as UnitTiming | null) ?? null;
  const script = unit?.script as UnitScript | null | undefined;

  const [editingId, setEditingId] = useState<string | null>(focusNarrationId);
  const [draft, setDraft] = useState("");
  const [savingSentence, setSavingSentence] = useState(false);
  const [sentenceError, setSentenceError] = useState<string | null>(null);
  const [beatDrafts, setBeatDrafts] = useState<Record<number, string>>({});
  const [beatErrors, setBeatErrors] = useState<Record<number, string | null>>({});
  const [savingBeatIndex, setSavingBeatIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!focusNarrationId) return;
    if (!editable) return;
    const sentence = sentences.find((entry) => entry.id === focusNarrationId);
    if (!sentence) return;
    setEditingId(sentence.id);
    setDraft(sentence.text);
    setSentenceError(null);
  }, [editable, focusNarrationId, sentences]);

  useEffect(() => {
    if (!editable) {
      setEditingId(null);
      setSentenceError(null);
    }
  }, [editable]);

  useEffect(() => {
    if (!unit) {
      setBeatDrafts({});
      setBeatErrors({});
      return;
    }
    const nextDrafts: Record<number, string> = {};
    for (let i = 0; i < cards.length; i += 1) {
      nextDrafts[i] = cards[i].enterAt.word;
    }
    setBeatDrafts(nextDrafts);
    setBeatErrors({});
  }, [unit?._id, cards]);

  if (!unit) {
    return (
      <div style={{ padding: 14, color: "#9aa3ad" }}>
        Select a unit to edit narration and card beats.
      </div>
    );
  }

  const brokenAnchors =
    editingId === null
      ? []
      : cards
          .map((card, index) => ({ card, index }))
          .filter(
            ({ card }) =>
              card.enterAt.narration === editingId &&
              !draft.includes(card.enterAt.word)
          );

  const startEditSentence = (sentence: PreviewNarrationSentence) => {
    if (!editable) return;
    setEditingId(sentence.id);
    setDraft(sentence.text);
    setSentenceError(null);
  };

  const onSaveSentence = async () => {
    if (!editingId || !editable) return;
    setSavingSentence(true);
    setSentenceError(null);
    try {
      const prevGeneratedAt = timing?.generatedAt ?? 0;
      const result = await updateSentence({
        runId,
        unitId: unit._id,
        narrationId: editingId,
        text: draft.trim(),
      });
      onSaved(String(unit._id), prevGeneratedAt, result.status);
      setEditingId(null);
    } catch (err) {
      setSentenceError(getUserFacingErrorMessage(err, "Edit failed. Try again."));
    } finally {
      setSavingSentence(false);
    }
  };

  const onSaveBeatWord = async (cardIndex: number) => {
    if (!editable) return;
    const card = cards[cardIndex];
    if (!card) return;
    const nextWord = (beatDrafts[cardIndex] ?? "").trim();
    const sentence = sentences.find((entry) => entry.id === card.enterAt.narration);
    if (!sentence || nextWord.length === 0 || !sentence.text.includes(nextWord)) {
      setBeatErrors((current) => ({
        ...current,
        [cardIndex]: "Word must appear in the linked narration sentence.",
      }));
      return;
    }

    setSavingBeatIndex(cardIndex);
    setBeatErrors((current) => ({ ...current, [cardIndex]: null }));
    try {
      await updateCardEnterAtWord({
        runId,
        unitId: unit._id,
        cardIndex,
        word: nextWord,
      });
    } catch (err) {
      setBeatErrors((current) => ({
        ...current,
        [cardIndex]: getUserFacingErrorMessage(err, "Could not update card beat."),
      }));
    } finally {
      setSavingBeatIndex(null);
    }
  };

  const beatCount = timing?.cardBeats.length ?? 0;
  const beatsMismatch = timing !== null && beatCount !== cards.length;

  return (
    <div style={{ padding: "24px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div style={{ color: "#f4f1e8", fontSize: 18, fontWeight: 800, lineHeight: 1.15 }}>
            Script &amp; cards
          </div>
          <div style={{ marginTop: 6, color: "#8b95a2", fontSize: 12, lineHeight: "17px" }}>
            Each card is anchored to the word it appears on. Tap a beat to preview it.
          </div>
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <div style={{ color: "#8b95a2", fontSize: 12, lineHeight: "17px", whiteSpace: "nowrap" }}>
            {cards.length} cards
          </div>
          <div style={{ color: beatsMismatch ? "#ff8c8c" : "#8b95a2", fontSize: 12, lineHeight: "17px", whiteSpace: "nowrap" }}>
            {unitCharacters(script).toLocaleString()} chars
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Chip
          label={resynthesizing ? "re-synthesising" : unit.state}
          tone={
            resynthesizing
              ? "accent"
              : unit.state === "assets_ready" || unit.state === "published"
                ? "ok"
                : unit.state === "blocked" || unit.error
                  ? "bad"
                  : "muted"
          }
        />
        <Chip label={timing ? formatMs(timing.totalDurationMs) : "no audio"} tone="muted" />
        <Chip label={`${beatCount}/${cards.length} beats`} tone={beatsMismatch ? "bad" : "muted"} />
        {unit.error && !resynthesizing ? (
          <Button
            variant="outline"
            size="sm"
            onPress={() => onRetry(unit._id)}
            isDisabled={!editable}
            className="border-[#303946] bg-[#111820]"
          >
            <ButtonText className="text-[#f4f1e8]">Retry</ButtonText>
          </Button>
        ) : null}
        {unit.state !== "blocked" ? (
          <Button
            variant="outline"
            size="sm"
            onPress={() => onRegenerate(unit._id)}
            isDisabled={!editable || resynthesizing}
            className="border-[#77611f] bg-[#17150d]"
          >
            <ButtonText className="text-[#d6ad2f]">
              {resynthesizing ? "Regenerating" : "Regenerate audio"}
            </ButtonText>
          </Button>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {sentences.map((sentence, sentenceIndex) => {
          const anchored = cards
            .map((card, index) => ({ card, index }))
            .filter(({ card }) => card.enterAt.narration === sentence.id);
          const isEditing = editingId === sentence.id;
          return (
            <div key={sentence.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 12 }}>
              <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
                <div
                  style={{
                    position: "absolute",
                    top: 20,
                    bottom: -18,
                    width: 1,
                    background: sentenceIndex === sentences.length - 1 ? "transparent" : "#27303b",
                  }}
                />
                <div
                  style={{
                    zIndex: 1,
                    color: "#697480",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    paddingTop: 3,
                  }}
                >
                  n{sentenceIndex + 1}
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <p style={{ margin: 0, color: "#f2efe8", fontSize: 14, lineHeight: "21px" }}>
                    {sentence.text}
                  </p>
                  {!isEditing && editable ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onPress={() => startEditSentence(sentence)}
                      className="h-7 border-[#303946] bg-[#111820] px-2"
                    >
                      <ButtonText className="text-[11px] text-[#f4f1e8]">Edit</ButtonText>
                    </Button>
                  ) : null}
                </div>

                {isEditing ? (
                  <div style={{ marginTop: 10 }}>
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      rows={4}
                      style={{
                        width: "100%",
                        resize: "vertical",
                        borderRadius: 10,
                        border: "1px solid #3f4754",
                        background: "#080d12",
                        color: "#e8e6e1",
                        padding: 11,
                        fontSize: 13,
                        lineHeight: 1.5,
                        fontFamily: "inherit",
                        outline: "none",
                      }}
                    />
                    {brokenAnchors.length > 0 ? (
                      <div style={{ marginTop: 8, color: "#ff8c8c", fontSize: 12, lineHeight: "17px" }}>
                        Card anchor{brokenAnchors.length > 1 ? "s" : ""} {brokenAnchors
                          .map(({ card, index }) => `#${index + 1} "${card.enterAt.word}"`)
                          .join(", ")} no longer appear in this sentence.
                      </div>
                    ) : null}
                    {sentenceError ? (
                      <div style={{ marginTop: 8, color: "#ff8c8c", fontSize: 12, lineHeight: "17px" }}>
                        {sentenceError}
                      </div>
                    ) : null}
                    <Box className="mt-3 flex-row gap-2">
                      <Button
                        size="sm"
                        onPress={onSaveSentence}
                        isDisabled={!editable || savingSentence || draft.trim().length === 0 || brokenAnchors.length > 0}
                        className="bg-[#d6ad2f] data-[hover=true]:bg-[#cba126] data-[active=true]:bg-[#cba126]"
                      >
                        <ButtonText className="text-[#101419]">
                          {savingSentence ? "Saving" : "Save"}
                        </ButtonText>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onPress={() => setEditingId(null)}
                        className="border-[#303946] bg-[#111820]"
                      >
                        <ButtonText className="text-[#f4f1e8]">Cancel</ButtonText>
                      </Button>
                    </Box>
                  </div>
                ) : null}

                {anchored.length > 0 ? (
                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                    {anchored.map(({ card, index }) => {
                      const draftWord = beatDrafts[index] ?? "";
                      const choices = anchorWordCandidates(sentence.text);
                      return (
                        <div
                          key={`${sentence.id}-${index}`}
                          style={{
                            border: `1px solid ${index === 0 ? "#78611e" : "#27313d"}`,
                            borderRadius: 12,
                            background: index === 0 ? "rgba(214,173,47,.09)" : "#111820",
                            padding: 12,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div
                              style={{
                                width: 38,
                                height: 38,
                                borderRadius: 8,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "#122236",
                                color: index === 0 ? "#d6ad2f" : "#7ea7df",
                                border: "1px solid #203247",
                                fontFamily: "'IBM Plex Mono', monospace",
                                fontSize: 12,
                                fontWeight: 800,
                              }}
                            >
                              {card.template.slice(0, 2).toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ color: "#f4f1e8", fontSize: 13, fontWeight: 700, lineHeight: "18px" }}>
                                {cardDisplayName(card.template)}
                              </div>
                              <div style={{ marginTop: 2, color: "#8b95a2", fontSize: 12, lineHeight: "17px" }}>
                                enters at "{card.enterAt.word}"
                              </div>
                            </div>
                          </div>
                          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                            <input
                              value={draftWord}
                              disabled={!editable}
                              onChange={(event) =>
                                setBeatDrafts((current) => ({ ...current, [index]: event.target.value }))
                              }
                              placeholder="Enter-at word"
                              style={{
                                flex: 1,
                                minWidth: 0,
                                borderRadius: 8,
                                border: "1px solid #303946",
                                background: "#080d12",
                                color: "#e8e6e1",
                                padding: "8px 10px",
                                fontSize: 12,
                                outline: "none",
                              }}
                            />
                            <Button
                              size="sm"
                              onPress={() => onSaveBeatWord(index)}
                              isDisabled={!editable || savingBeatIndex === index || draftWord.trim().length === 0}
                              className="bg-[#d6ad2f] data-[hover=true]:bg-[#cba126] data-[active=true]:bg-[#cba126]"
                            >
                              <ButtonText className="text-[#101419]">
                                {savingBeatIndex === index ? "Saving" : "Save"}
                              </ButtonText>
                            </Button>
                          </div>
                          {choices.length > 0 ? (
                            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {choices.slice(0, 8).map((word) => (
                                <button
                                  key={`${index}-${word}`}
                                  type="button"
                                  disabled={!editable}
                                  onClick={() => setBeatDrafts((current) => ({ ...current, [index]: word }))}
                                  style={{
                                    border: "1px solid #303946",
                                    borderRadius: 999,
                                    background: "transparent",
                                    color: "#8b95a2",
                                    fontSize: 10,
                                    padding: "2px 8px",
                                    cursor: "pointer",
                                  }}
                                >
                                  {word}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {beatErrors[index] ? (
                            <div style={{ marginTop: 8, color: "#ff8c8c", fontSize: 12, lineHeight: "17px" }}>
                              {beatErrors[index]}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
