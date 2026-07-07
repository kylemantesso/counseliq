"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "solito/navigation";
import type { UnitScript, UnitTiming } from "@counseliq/course-schema";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  ScrollView,
  Text,
} from "@counseliq/ui";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { CoursePlayer } from "../components/course-player/course-player";
import { formatMs } from "../components/course-player/timeline-helpers";
import type {
  PreviewCard,
  PreviewNarrationSentence,
  PreviewQuestion,
  PreviewUnit,
  PreviewUnitState,
  RunPreviewData,
} from "../components/course-player/types";
import { Screen } from "../components/screen";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

/**
 * Gate 3 — the playable preview studio. The course player fills the main
 * pane (module rail, phase pills, audio-driven cards); above it sit the
 * approve/reject actions and the blocked/failed banner that gates approval.
 * A per-unit strip under the player carries synthesis facts (duration,
 * characters, beat coverage) plus narration-edit and retry entry points.
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
  };
}

function toRunPreviewData(preview: PreviewPayload, runId: string): RunPreviewData {
  return {
    runId,
    runState: preview.run.state,
    course: { title: preview.course.title, version: preview.course.version },
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

// --- screen -----------------------------------------------------------------

function AdminGateThreeReviewContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const runId = params?.id as Id<"runs"> | undefined;

  const preview = useQuery(
    api.pipeline.tts.preview.adminGetRunPreview,
    runId ? { runId } : "skip"
  );
  const decideGate = useMutation(api.pipeline.runs.adminDecideGate);
  const updateSentence = useMutation(
    api.pipeline.tts.edit.adminUpdateNarrationSentence
  );
  const retryUnit = useMutation(api.pipeline.tts.edit.adminRetryUnitTts);
  const presignBatch = useAction(api.pipeline.objectStore.adminPresignGetBatch);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [editTarget, setEditTarget] = useState<{
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

  // unitId → generatedAt at edit time; cleared when a newer timing arrives.
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

  if (preview === undefined) {
    return (
      <Screen className="flex-1 bg-background">
        <Box className="p-6">
          <Text>Loading...</Text>
        </Box>
      </Screen>
    );
  }
  if (preview === null || !runId || !data) {
    return (
      <Screen className="flex-1 bg-background">
        <Box className="p-6">
          <Text className="text-muted-foreground">
            Run not found, or it has no compiled course yet.
          </Text>
        </Box>
      </Screen>
    );
  }

  const atGate = preview.run.state === "GATE_3_PREVIEW";
  const blockedUnits = allUnits.filter((u) => u.state === "blocked");
  const failedUnits = allUnits.filter((u) => u.error);
  const approveBlockedReason = !atGate
    ? `Run is at ${preview.run.state}, not GATE_3_PREVIEW.`
    : blockedUnits.length > 0
      ? "Blocked units must be resolved before publishing."
      : failedUnits.length > 0
        ? "Failed units must synthesise before publishing."
        : null;

  const onApprove = async () => {
    setError(null);
    setBusy(true);
    try {
      await decideGate({ runId, gate: 3, decision: "approve" });
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Gate decision failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const onReject = async () => {
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
      setError(getUserFacingErrorMessage(err, "Gate decision failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const onRetryUnit = async (unitId: Id<"microUnits">) => {
    setError(null);
    try {
      await retryUnit({ runId, unitId });
      setResynth((current) => new Map(current).set(String(unitId), 0));
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Retry failed. Try again."));
    }
  };

  const editUnit = editTarget
    ? allUnits.find((u) => String(u._id) === editTarget.unitId) ?? null
    : null;

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center flex-wrap gap-3">
        <Box className="flex-row items-center gap-3 flex-wrap">
          <Heading size="md">Gate 3 — preview &amp; publish</Heading>
          <Chip label={preview.run.state} tone={atGate ? "accent" : "muted"} />
          <Chip
            label={`${preview.summary.ready}/${preview.summary.total} ready`}
            tone={preview.summary.ready === preview.summary.total ? "ok" : "muted"}
          />
          {preview.summary.blocked > 0 ? (
            <Chip label={`${preview.summary.blocked} blocked`} tone="bad" />
          ) : null}
          {preview.summary.failed > 0 ? (
            <Chip label={`${preview.summary.failed} failed`} tone="bad" />
          ) : null}
          <Chip label={formatMs(preview.summary.totalDurationMs)} tone="muted" />
        </Box>
        <Box className="flex-row items-center gap-2">
          <Button variant="outline" size="sm" onPress={() => router.back()}>
            <ButtonText>Back</ButtonText>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onPress={() => setRejecting((r) => !r)}
            isDisabled={busy || !atGate}
          >
            <ButtonText>Reject to gate 2</ButtonText>
          </Button>
          <div title={approveBlockedReason ?? "Publish this course"}>
            <Button
              size="sm"
              onPress={onApprove}
              isDisabled={busy || approveBlockedReason !== null}
            >
              <ButtonText>Approve &amp; publish</ButtonText>
            </Button>
          </div>
        </Box>
      </Box>

      <Box className="px-6 pt-3 flex-col gap-3">
        <Text className="text-muted-foreground text-xs">
          {preview.course.title} · v{preview.course.version} ·{" "}
          {preview.institution?.name ?? "CounselIQ"} · voice{" "}
          {preview.institution?.voiceConfig?.voiceRef ?? "(default)"} ·{" "}
          {preview.summary.totalCharacters.toLocaleString()} characters
        </Text>

        {error ? <Text className="text-destructive text-sm">{error}</Text> : null}

        {rejecting ? (
          <Box className="bg-card border border-border rounded-lg p-4 flex-col gap-2">
            <Text className="font-semibold text-sm">
              Reject and send back to gate 2
            </Text>
            <textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Reviewer notes (required) — what must change before this course can publish?"
              rows={3}
              style={{
                width: "100%",
                resize: "vertical",
                borderRadius: 8,
                border: "1px solid var(--border, #d3d5da)",
                padding: 10,
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
            <Box className="flex-row gap-2">
              <Button
                size="sm"
               
                onPress={onReject}
                isDisabled={busy || rejectNotes.trim().length === 0}
              >
                <ButtonText>Confirm reject</ButtonText>
              </Button>
              <Button variant="outline" size="sm" onPress={() => setRejecting(false)}>
                <ButtonText>Cancel</ButtonText>
              </Button>
            </Box>
          </Box>
        ) : null}

        {blockedUnits.length > 0 || failedUnits.length > 0 ? (
          <Box className="bg-destructive/10 border border-destructive rounded-lg p-4 flex-col gap-2">
            <Text className="font-semibold text-destructive text-sm">
              Approval is blocked
            </Text>
            {blockedUnits.map((unit) => (
              <Box key={String(unit._id)} className="flex-row items-center gap-2 flex-wrap">
                <Chip label="BLOCKED" tone="bad" />
                <Text className="text-sm font-semibold">{unit.unitKey}</Text>
                <Text className="text-sm text-muted-foreground">{unit.concept}</Text>
                <Text className="text-sm text-destructive">
                  Unconfirmed pronunciation:{" "}
                  {unitBlockedTerms(unit.script as UnitScript | null).join(", ") ||
                    "(see lexicon)"}
                  {" — resolve CONFIRM_WITH_INSTITUTION in the institution lexicon."}
                </Text>
              </Box>
            ))}
            {failedUnits.map((unit) => (
              <Box key={String(unit._id)} className="flex-row items-center gap-2 flex-wrap">
                <Chip label="FAILED" tone="bad" />
                <Text className="text-sm font-semibold">{unit.unitKey}</Text>
                <Text className="text-sm text-destructive">
                  {(unit.error?.cause ?? "synthesis failed").slice(0, 140)}
                </Text>
                {resynth.has(String(unit._id)) ? (
                  <Chip label="re-synthesising…" tone="accent" />
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => onRetryUnit(unit._id)}
                  >
                    <ButtonText>Retry</ButtonText>
                  </Button>
                )}
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>

      <Box className="flex-1 px-6 py-4" style={{ minHeight: 620 }}>
        <CoursePlayer
          data={data}
          presignedUrls={urls}
          onRequestUrls={requestUrls}
          onEditSentence={(unitId, narrationId) =>
            setEditTarget({ unitId, narrationId })
          }
        />
      </Box>

      <UnitInfoStrip
        units={allUnits}
        resynth={resynth}
        onEdit={(unitId) => setEditTarget({ unitId, narrationId: null })}
        onRetry={onRetryUnit}
      />

      {editUnit ? (
        <NarrationEditPanel
          runId={runId}
          unit={editUnit}
          focusNarrationId={editTarget?.narrationId ?? null}
          resynthesizing={resynth.has(String(editUnit._id))}
          onClose={() => setEditTarget(null)}
          onSaved={(unitId, prevGeneratedAt, status) => {
            if (status === "resynthesizing") {
              setResynth((current) =>
                new Map(current).set(unitId, prevGeneratedAt)
              );
            }
          }}
          updateSentence={updateSentence}
        />
      ) : null}
    </Screen>
  );
}

// --- pieces -----------------------------------------------------------------

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "bad" | "accent" | "muted";
}) {
  const palette: Record<string, { border: string; color: string }> = {
    ok: { border: "#3f8f5f", color: "#3f8f5f" },
    bad: { border: "#c0392b", color: "#c0392b" },
    accent: { border: "#2f6feb", color: "#2f6feb" },
    muted: { border: "#9aa3ad", color: "#6a737d" },
  };
  const { border, color } = palette[tone];
  return (
    <span
      style={{
        border: `1px solid ${border}`,
        color,
        borderRadius: 999,
        padding: "2px 10px",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/** Studio facts per unit: duration, characters, beat coverage, edit/retry. */
function UnitInfoStrip({
  units,
  resynth,
  onEdit,
  onRetry,
}: {
  units: Array<{
    _id: Id<"microUnits">;
    unitKey: string;
    state: string;
    error?: { retryable: boolean; cause: string } | null;
    cards: unknown;
    script: unknown;
    timing: unknown;
  }>;
  resynth: Map<string, number>;
  onEdit: (unitId: string) => void;
  onRetry: (unitId: Id<"microUnits">) => void;
}) {
  return (
    <ScrollView horizontal className="border-t border-border bg-card px-6 py-3">
      <Box className="flex-row gap-3">
        {units.map((unit) => {
          const timing = unit.timing as UnitTiming | null;
          const script = unit.script as UnitScript | null;
          const cards = (unit.cards as unknown[]) ?? [];
          const beats = timing?.cardBeats.length ?? 0;
          const beatsMismatch = timing !== null && beats !== cards.length;
          const busyChip = resynth.has(String(unit._id));
          return (
            <Box
              key={String(unit._id)}
              className="border border-border rounded-lg px-3 py-2 flex-col gap-1"
              style={{ minWidth: 190 }}
            >
              <Box className="flex-row items-center gap-2">
                <Text className="font-semibold text-xs">{unit.unitKey}</Text>
                <Chip
                  label={busyChip ? "re-synthesising…" : unit.state}
                  tone={
                    busyChip
                      ? "accent"
                      : unit.state === "assets_ready" || unit.state === "published"
                        ? "ok"
                        : unit.state === "blocked" || unit.error
                          ? "bad"
                          : "muted"
                  }
                />
              </Box>
              <Text className="text-muted-foreground text-xs">
                {timing ? formatMs(timing.totalDurationMs) : "no audio"} ·{" "}
                {unitCharacters(script).toLocaleString()} chars ·{" "}
                <span style={beatsMismatch ? { color: "#c0392b", fontWeight: 600 } : undefined}>
                  {beats}/{cards.length} beats
                </span>
                {timing ? ` · ${timing.voiceRef}` : ""}
              </Text>
              <Box className="flex-row gap-2">
                <Button variant="outline" size="sm" onPress={() => onEdit(String(unit._id))}>
                  <ButtonText>Edit narration</ButtonText>
                </Button>
                {unit.error && !busyChip ? (
                  <Button variant="outline" size="sm" onPress={() => onRetry(unit._id)}>
                    <ButtonText>Retry</ButtonText>
                  </Button>
                ) : null}
              </Box>
            </Box>
          );
        })}
      </Box>
    </ScrollView>
  );
}

/** E5 — the minimal single-sentence edit loop, as a right slide-over. */
function NarrationEditPanel({
  runId,
  unit,
  focusNarrationId,
  resynthesizing,
  onClose,
  onSaved,
  updateSentence,
}: {
  runId: Id<"runs">;
  unit: {
    _id: Id<"microUnits">;
    unitKey: string;
    narration: unknown;
    cards: unknown;
    timing: unknown;
    state: string;
  };
  focusNarrationId: string | null;
  resynthesizing: boolean;
  onClose: () => void;
  onSaved: (
    unitId: string,
    prevGeneratedAt: number,
    status: "updated" | "blocked" | "resynthesizing"
  ) => void;
  updateSentence: (args: {
    runId: Id<"runs">;
    unitId: Id<"microUnits">;
    narrationId: string;
    text: string;
  }) => Promise<{ status: "updated" | "blocked" | "resynthesizing" }>;
}) {
  const sentences = (unit.narration as PreviewNarrationSentence[]) ?? [];
  const cards = (unit.cards as PreviewCard[]) ?? [];
  const timing = unit.timing as UnitTiming | null;

  const [editingId, setEditingId] = useState<string | null>(focusNarrationId);
  const [draft, setDraft] = useState<string>(() => {
    const focused = sentences.find((s) => s.id === focusNarrationId);
    return focused?.text ?? "";
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (sentence: PreviewNarrationSentence) => {
    setEditingId(sentence.id);
    setDraft(sentence.text);
    setError(null);
  };

  // Card anchors that the current draft would orphan (pre-validation; the
  // backend enforces the same rule with NARRATION_EDIT_BREAKS_CARD).
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

  const onSave = async () => {
    if (!editingId) return;
    setSaving(true);
    setError(null);
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
      setError(getUserFacingErrorMessage(err, "Edit failed. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`Edit narration — ${unit.unitKey}`}
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(440px, 92vw)",
        background: "#ffffff",
        borderLeft: "1px solid #d3d5da",
        boxShadow: "-12px 0 32px rgba(15, 18, 22, .18)",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box className="flex-row justify-between items-center border-b border-border px-4 py-3">
        <Box className="flex-col">
          <Text className="font-semibold text-sm">
            Narration — {unit.unitKey}
          </Text>
          <Text className="text-muted-foreground text-xs">
            Edits re-synthesise only the changed sentence.
          </Text>
        </Box>
        <Box className="flex-row items-center gap-2">
          {resynthesizing ? <Chip label="re-synthesising…" tone="accent" /> : null}
          {unit.state === "blocked" ? <Chip label="BLOCKED" tone="bad" /> : null}
          <Button variant="outline" size="sm" onPress={onClose}>
            <ButtonText>Close</ButtonText>
          </Button>
        </Box>
      </Box>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {sentences.map((sentence) => {
          const anchored = cards.filter(
            (card) => card.enterAt.narration === sentence.id
          );
          const isEditing = editingId === sentence.id;
          return (
            <div
              key={sentence.id}
              style={{
                border: `1px solid ${isEditing ? "#2f6feb" : "#e2e4e8"}`,
                borderRadius: 10,
                padding: 12,
                marginBottom: 10,
              }}
            >
              <Box className="flex-row justify-between items-center">
                <Text className="text-muted-foreground text-xs">
                  {sentence.id}
                  {anchored.length > 0
                    ? ` · anchors ${anchored
                        .map((c) => `“${c.enterAt.word}”`)
                        .join(", ")}`
                    : ""}
                </Text>
                {!isEditing ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => startEdit(sentence)}
                  >
                    <ButtonText>Edit</ButtonText>
                  </Button>
                ) : null}
              </Box>
              {isEditing ? (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                    autoFocus
                    style={{
                      width: "100%",
                      resize: "vertical",
                      borderRadius: 8,
                      border: "1px solid #d3d5da",
                      padding: 10,
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                  {brokenAnchors.length > 0 ? (
                    <Text className="text-destructive text-xs">
                      Card anchor
                      {brokenAnchors.length > 1 ? "s" : ""}{" "}
                      {brokenAnchors
                        .map(
                          ({ card, index }) =>
                            `#${index + 1} “${card.enterAt.word}”`
                        )
                        .join(", ")}{" "}
                      no longer appear{brokenAnchors.length > 1 ? "" : "s"} in
                      the sentence — restore the word or edit the card first.
                    </Text>
                  ) : null}
                  {error ? (
                    <Text className="text-destructive text-xs">{error}</Text>
                  ) : null}
                  <Box className="flex-row gap-2 mt-2">
                    <Button
                      size="sm"
                      onPress={onSave}
                      isDisabled={
                        saving ||
                        draft.trim().length === 0 ||
                        brokenAnchors.length > 0
                      }
                    >
                      <ButtonText>{saving ? "Saving…" : "Save"}</ButtonText>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onPress={() => setEditingId(null)}
                    >
                      <ButtonText>Cancel</ButtonText>
                    </Button>
                  </Box>
                </div>
              ) : (
                <Text className="text-sm mt-1">{sentence.text}</Text>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
