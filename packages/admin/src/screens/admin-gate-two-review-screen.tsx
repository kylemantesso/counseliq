"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  Input,
  InputField,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  Pressable,
  ScrollView,
  Text,
  Textarea,
  TextareaInput,
} from "@counseliq/ui";
import { Image } from "react-native";
import { supportsAvatarOverlay } from "@counseliq/course-schema";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
import { CardStaticPreview } from "../components/card-static-preview";
import { AvatarPresentationPanel } from "../components/avatar-presentation-panel";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

/**
 * Step 2 — course review. The compiled course IS the review surface: module
 * → unit tree with QA chips on the left; narration with judge provenance
 * markers, editable cards, questions, and the anchor on the right. Actions:
 * approve the step, send selected units back for re-authoring, and directly
 * edit course text where the generated draft only needs human adjustment.
 */
export function AdminGateTwoReviewScreen() {
  return (
    <AdminGuard>
      <AdminGateTwoReviewContent />
    </AdminGuard>
  );
}

// --- Shapes stored in schemaless columns (meta / qa / body) ---

interface NarrationSentence {
  id: string;
  text: string;
}

interface UnitCard {
  template: string;
  props: Record<string, unknown>;
  visualTreatment?: "standard" | "avatar-overlay";
  enterAt: { narration: string; word: string };
  provenance: string;
}

interface UnitMeta {
  secondsBudget: number;
  hook: { type: string; questionRef: string };
  retrieve: string[];
  anchor: { template: string; props: Record<string, unknown> };
  conceptKey?: string;
  order: { module: number; unit: number };
  complianceWarnings?: string[];
}

interface JudgeFlag {
  code: string;
  severity: "warning" | "error";
  message: string;
}

interface SentenceClassification {
  narrationId: string;
  classification: "traced" | "derived" | "unsupported";
  refs: string[];
  note: string | null;
}

interface UnitQa {
  flags: JudgeFlag[];
  sentenceClassifications: SentenceClassification[];
  judgeModel?: string;
}

interface NarrationParagraphChunk {
  sentence: NarrationSentence;
  text: string;
}

type NarrationParagraph = NarrationParagraphChunk[];

interface CourseQa {
  pass: boolean;
  courseFlags: JudgeFlag[];
  errorCount: number;
  warningCount: number;
  judgeModel?: string;
}

interface QuestionBody {
  id: string;
  conceptTag: string;
  type: "commit" | "mcq";
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

function runStepLabel(state: string): string {
  if (state === "OUTLINE_REVIEW") return "Outline approval";
  if (state === "GATE_2_COURSE_REVIEW") return "Step 2 - course review";
  if (state === "GATE_3_PREVIEW") return "Step 3 - preview and publish";
  return state;
}

function backgroundVariantForCard(props: Record<string, unknown>): {
  treatment: "subtle" | "faded" | "duotone" | "spotlight";
} | null {
  if (typeof props.bgAssetRef !== "string" || props.bgAssetRef.trim() === "") {
    return null;
  }
  const treatment =
    props.bgTreatment === "faded" ||
    props.bgTreatment === "duotone" ||
    props.bgTreatment === "spotlight"
      ? props.bgTreatment
      : "subtle";
  return { treatment };
}

interface PreviewAsset {
  objectKey: string;
  thumbKey?: string;
  kind: string;
  durationMs?: number;
}

interface VoiceSettings {
  stability?: number;
  speed?: number;
}

interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  previewUrl: string | null;
  labels: Record<string, string>;
}

interface CourseTtsVoice {
  provider: string;
  voiceRef: string;
  voiceId: string;
  name?: string;
  accent?: EnglishAccentFilter;
  settings?: VoiceSettings;
}

type EnglishAccentFilter = "all" | "australian" | "american" | "english";

const ENGLISH_ACCENTS: Array<{ value: EnglishAccentFilter; label: string }> = [
  { value: "all", label: "All English" },
  { value: "australian", label: "Australian" },
  { value: "american", label: "American" },
  { value: "english", label: "English" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function avatarLookForUnit(
  presentation: unknown,
  unitKey: string
): { previewImageUrl?: string | null; name?: string } | null {
  if (!isRecord(presentation) || presentation.mode !== "avatar") return null;
  const assignments = isRecord(presentation.unitAssignments)
    ? presentation.unitAssignments
    : {};
  const assignment = isRecord(assignments[unitKey]) ? assignments[unitKey] : null;
  if (assignment && isRecord(assignment.look)) return assignment.look;
  const unitLooks = isRecord(presentation.unitLooks) ? presentation.unitLooks : {};
  const look = unitLooks[unitKey];
  if (isRecord(look)) return look;
  return isRecord(presentation.defaultLook) ? presentation.defaultLook : null;
}

function AdminGateTwoReviewContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const runId = params?.id as Id<"runs"> | undefined;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<Id<"microUnits"> | null>(
    null
  );
  const [sendBackIds, setSendBackIds] = useState<Set<Id<"microUnits">>>(
    new Set()
  );
  const [voiceStudioOpen, setVoiceStudioOpen] = useState(false);

  const runResult = useQuery(
    api.pipeline.queries.getRun,
    runId ? { runId } : "skip"
  );
  const courseData = useQuery(
    api.pipeline.courses.getRunCourse,
    runId ? { runId } : "skip"
  );
  const preview = useQuery(
    api.pipeline.tts.preview.adminGetRunPreview,
    runId ? { runId } : "skip"
  );
  const decideGate = useMutation(api.pipeline.runs.adminDecideGate);
  const sendBack = useMutation(api.pipeline.runs.adminSendBackForReauthoring);
  const presignBatch = useAction(api.pipeline.objectStore.adminPresignGetBatch);
  const [assetUrls, setAssetUrls] = useState<ReadonlyMap<string, string>>(
    new Map()
  );

  const run = runResult?.run;
  const atGate = run?.state === "GATE_2_COURSE_REVIEW";
  const units = useMemo(() => courseData?.units ?? [], [courseData]);
  const questionsById = useMemo(() => {
    const map = new Map<string, Doc<"questions">>();
    for (const row of courseData?.questions ?? []) {
      map.set((row.body as QuestionBody).id, row);
    }
    return map;
  }, [courseData]);

  const modules = useMemo(() => {
    const grouped: Array<{ moduleKey: string; title: string; units: Doc<"microUnits">[] }> = [];
    for (const unit of units) {
      let entry = grouped.find((m) => m.moduleKey === unit.moduleKey);
      if (!entry) {
        entry = {
          moduleKey: unit.moduleKey,
          title: unit.moduleTitle?.trim() || moduleDisplayTitle(unit.moduleKey),
          units: [],
        };
        grouped.push(entry);
      }
      entry.units.push(unit);
    }
    return grouped;
  }, [units]);

  const selectedUnit =
    units.find((unit) => unit._id === selectedUnitId) ?? units[0] ?? null;
  const auditionText = useMemo(() => {
    const narration = (selectedUnit?.narration ?? units[0]?.narration ?? []) as NarrationSentence[];
    return narration[0]?.text ?? "";
  }, [selectedUnit?.narration, units]);
  const currentVoice = (preview?.course?.ttsVoice as CourseTtsVoice | null | undefined) ?? null;
  const courseQa = courseData?.course.qa as CourseQa | undefined;
  const assetsByRef = useMemo(
    () => (preview?.assets ?? {}) as Record<string, PreviewAsset>,
    [preview?.assets]
  );
  const gateThemeTokens = useMemo(() => {
    const institutionTokens = preview?.institution?.brandTokens;
    const brandRef = preview?.course?.brandRef;
    if (isRecord(institutionTokens) && typeof brandRef === "string" && brandRef.length > 0) {
      return {
        ...institutionTokens,
        brandRef,
      };
    }
    if (institutionTokens !== undefined && institutionTokens !== null) return institutionTokens;
    return typeof brandRef === "string" && brandRef.length > 0
      ? { brandRef }
      : undefined;
  }, [preview?.institution?.brandTokens, preview?.course?.brandRef]);

  const courseHealth = useMemo(() => {
    const cleanUnits = units.filter((unit) => unitIssueCount(unit) === 0).length;
    if (courseQa) {
      return {
        blocking: courseQa.errorCount,
        advisory: courseQa.warningCount,
        clean: cleanUnits,
        total: units.length,
      };
    }

    let blocking = 0;
    let advisory = 0;
    for (const unit of units) {
      const qa = unit.qa as UnitQa | undefined;
      for (const flag of qa?.flags ?? []) {
        if (flag.severity === "error") blocking += 1;
        else advisory += 1;
      }
      advisory += ((unit.meta as UnitMeta).complianceWarnings ?? []).length;
    }
    return { blocking, advisory, clean: cleanUnits, total: units.length };
  }, [courseQa, units]);

  useEffect(() => {
    const wanted = new Set<string>();
    for (const asset of Object.values(assetsByRef)) {
      wanted.add(asset.objectKey);
      if (asset.thumbKey) wanted.add(asset.thumbKey);
    }
    const missing = [...wanted].filter((key) => !assetUrls.has(key));
    if (missing.length === 0) return;
    let cancelled = false;
    presignBatch({ keys: missing })
      .then((results) => {
        if (cancelled) return;
        setAssetUrls((current) => {
          const next = new Map(current);
          for (const { key, url } of results) next.set(key, url);
          return next;
        });
      })
      .catch(() => {
        // Gate-2 card previews still work without media bytes.
      });
    return () => {
      cancelled = true;
    };
  }, [assetsByRef, assetUrls, presignBatch]);

  const resolveAssetRef = useMemo(
    () =>
      (ref: string): string | null => {
        const isPoster = ref.startsWith("poster:");
        const assetRef = isPoster ? ref.slice("poster:".length) : ref;
        const asset = assetsByRef[assetRef];
        if (!asset) return null;
        const key = isPoster ? asset.thumbKey ?? asset.objectKey : asset.objectKey;
        return assetUrls.get(key) ?? null;
      },
    [assetsByRef, assetUrls]
  );

  const onApprove = async () => {
    if (!runId) return;
    if (!atGate) {
      router.push(`/admin/runs/${runId}`);
      return;
    }
    if (!currentVoice) {
      setError("Choose and save a narration voice before approving this course.");
      setVoiceStudioOpen(true);
      return;
    }
    setError(null);
    setBusy(true);
    setApproving(true);
    try {
      await decideGate({ runId, gate: 2, decision: "approve" });
      router.push(`/admin/runs/${runId}`);
    } catch (err) {
      setError(
        getUserFacingErrorMessage(err, "Review decision failed. Try again.")
      );
    } finally {
      setBusy(false);
      setApproving(false);
    }
  };

  const onSendBack = async () => {
    if (!runId || sendBackIds.size === 0) return;
    setError(null);
    setBusy(true);
    try {
      await sendBack({ runId, unitIds: [...sendBackIds] });
      setSendBackIds(new Set());
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Send-back failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const toggleSendBack = (unitId: Id<"microUnits">) => {
    if (!atGate) return;
    setSendBackIds((current) => {
      const next = new Set(current);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  return (
    <AdminWorkspaceFrame
      activeNav="runs"
      title="Course review"
      showPageHeader={false}
      contentClassName="flex-1 min-h-0 bg-[#f5f3ee] p-0"
    >
      {runResult === undefined || courseData === undefined ? (
        <Box className="flex-1 items-center justify-center p-6">
          <Text>Loading...</Text>
        </Box>
      ) : !run ? (
        <ReviewEmptyState title="Run not found" />
      ) : !courseData ? (
        <ReviewEmptyState title="No compiled course on this run yet" />
      ) : (
        <Box className="flex-1 min-h-0">
          <Box className="shrink-0 border-b border-[#dedbd2] bg-[#f8f6f0] px-5 py-4">
            <Box className="flex-row flex-wrap items-start justify-between gap-3">
              <Box className="min-w-[260px] flex-1 gap-2">
                <Box className="gap-1">
                  <Heading size="lg" className="text-[24px] leading-8 tracking-[-0.03em]">
                    Course review
                  </Heading>
                  {runId ? (
                    <CourseTitleEditor
                      runId={runId}
                      title={courseData.course.title}
                      editable={atGate}
                      onError={setError}
                    />
                  ) : null}
                </Box>
                <Box className="flex-row flex-wrap items-center gap-2">
                  <Pill tone="neutral" label={`${courseData.course.title} · v${courseData.course.version}`} />
                  <Pill tone={courseHealth.blocking > 0 ? "danger" : "success"} label={`${courseHealth.blocking} blocking`} />
                  <Pill tone={courseHealth.advisory > 0 ? "warning" : "neutral"} label={`${courseHealth.advisory} advisory`} />
                  <Pill tone="neutral" label={`${courseHealth.clean} of ${courseHealth.total} units clean`} />
                </Box>
              </Box>

              <Box className="flex-row flex-wrap items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => setVoiceStudioOpen(true)}
                  isDisabled={!atGate || !runId}
                  className="web:cursor-pointer rounded-full data-[disabled=true]:web:cursor-not-allowed"
                >
                  <ButtonText>
                    {currentVoice?.name ? `Voice: ${currentVoice.name}` : "Choose narration voice"}
                  </ButtonText>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={onSendBack}
                  isDisabled={!atGate || busy || sendBackIds.size === 0}
                  className="web:cursor-pointer rounded-full data-[disabled=true]:web:cursor-not-allowed"
                >
                  <ButtonText>
                    {sendBackIds.size > 0
                      ? `↩ Send back ${sendBackIds.size}`
                      : "↩ Send back selected"}
                  </ButtonText>
                </Button>
                <Button
                  size="sm"
                  onPress={() => void onApprove()}
                  isDisabled={approving}
                  className="web:cursor-pointer rounded-full bg-[#1f1d1a] data-[disabled=true]:web:cursor-wait"
                >
                  <ButtonText>
                    {approving ? "Approving course..." : "Approve course review"}
                  </ButtonText>
                </Button>
              </Box>
            </Box>

            {courseQa && courseQa.courseFlags.length > 0 ? (
              <Box className="mt-3 gap-1">
                {courseQa.courseFlags.map((flag, index) => (
                  <FlagRow key={`course-flag-${index}`} flag={flag} />
                ))}
              </Box>
            ) : null}
            {error ? (
              <Box className="mt-3 rounded-xl border border-destructive bg-destructive/10 px-3 py-2">
                <Text className="text-sm text-destructive">{error}</Text>
              </Box>
            ) : null}
            {!atGate ? (
              <Text className="mt-2 text-xs text-muted-foreground">
                This run is currently {runStepLabel(run.state)}; review actions are disabled.
              </Text>
            ) : !currentVoice ? (
              <Text className="mt-2 text-xs text-muted-foreground">
                Choose and save a narration voice before approving. TTS uses the saved course voice.
              </Text>
            ) : null}
          </Box>

          {runId ? (
            <VoiceStudioModal
              isOpen={voiceStudioOpen}
              runId={runId}
              auditionText={auditionText}
              currentVoice={currentVoice}
              onClose={() => setVoiceStudioOpen(false)}
              onError={setError}
            />
          ) : null}

          <Box className="flex-1 min-h-0 flex-col xl:flex-row">
            <UnitQueuePanel
              modules={modules}
              runId={runId}
              selectedUnit={selectedUnit}
              sendBackIds={sendBackIds}
              onSelect={(unitId) => setSelectedUnitId(unitId)}
              onToggleSendBack={toggleSendBack}
              editable={atGate}
              onError={setError}
            />

            <ScrollView className="min-h-0 flex-1 min-w-0 bg-[#fbfaf6] xl:border-r xl:border-[#dedbd2]">
              {selectedUnit && runId ? (
                <UnitDetail
                  unit={selectedUnit}
                  runId={runId}
                  questionsById={questionsById}
                  markedForSendBack={sendBackIds.has(selectedUnit._id)}
                  onToggleSendBack={() => toggleSendBack(selectedUnit._id)}
                  editable={atGate}
                  presentation={(courseData.course.definitionMeta as { presentation?: unknown } | undefined)?.presentation}
                  onError={setError}
                />
              ) : (
                <ReviewEmptyState title="No units" />
              )}
            </ScrollView>

            {selectedUnit && runId ? (
              <CardDeckPanel
                unit={selectedUnit}
                runId={runId}
                resolveAssetRef={resolveAssetRef}
                brandTokens={gateThemeTokens}
                presentation={(courseData.course.definitionMeta as { presentation?: unknown } | undefined)?.presentation}
                editable={atGate}
                onError={setError}
              />
            ) : null}
          </Box>
        </Box>
      )}
    </AdminWorkspaceFrame>
  );
}

function ReviewEmptyState({ title }: { title: string }) {
  return (
    <Box className="flex-1 items-center justify-center p-6">
      <Text className="text-sm text-muted-foreground">{title}</Text>
    </Box>
  );
}

function voiceInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "V";
}

function voiceDetail(voice: ElevenLabsVoice): string {
  const labelValues = Object.values(voice.labels).filter(Boolean);
  if (labelValues.length > 0) return labelValues.slice(0, 4).join(" · ");
  if (voice.description) return voice.description;
  return voice.category ?? "ElevenLabs voice";
}

function formatVoiceSetting(value: number | undefined, fallback: number): string {
  return String(value ?? fallback);
}

function voiceSearchText(voice: ElevenLabsVoice): string {
  return [
    voice.name,
    voice.category ?? "",
    voice.description ?? "",
    ...Object.entries(voice.labels).flatMap(([key, value]) => [key, value]),
  ]
    .join(" ")
    .toLowerCase();
}

function voiceMatchesAccent(voice: ElevenLabsVoice, accent: EnglishAccentFilter): boolean {
  if (accent === "all") return true;
  const text = voiceSearchText(voice);
  if (accent === "australian") return /\baustralian\b|\bau\b|\baussie\b/.test(text);
  if (accent === "american") {
    return /\bamerican\b|\bunited states\b|\bus\b|\busa\b/.test(text);
  }
  return /\benglish\b|\bbritish\b|\buk\b|\bengland\b|received pronunciation|\brp\b/.test(text);
}

function normalizedAccentFilter(value: string | undefined): EnglishAccentFilter {
  return value === "australian" || value === "american" || value === "english"
    ? value
    : "all";
}

function VoiceStudioModal({
  isOpen,
  runId,
  auditionText,
  currentVoice,
  onClose,
  onError,
}: {
  isOpen: boolean;
  runId: Id<"runs">;
  auditionText: string;
  currentVoice: CourseTtsVoice | null;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const listVoices = useAction(api.pipeline.tts.voice.adminListVoices);
  const auditionVoice = useAction(api.pipeline.tts.voice.adminAuditionVoice);
  const setCourseVoice = useMutation(api.pipeline.tts.voice.adminSetCourseVoice);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [accentFilter, setAccentFilter] = useState<EnglishAccentFilter>("all");
  const [accentMenuOpen, setAccentMenuOpen] = useState(false);
  const [settings, setSettings] = useState<VoiceSettings>({ speed: 1, stability: 0.55 });
  const [auditioningVoiceId, setAuditioningVoiceId] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingVoiceId(null);
      setAuditioningVoiceId(null);
      return;
    }
    setSelectedVoiceId(currentVoice?.voiceId ?? null);
    setAccentFilter(normalizedAccentFilter(currentVoice?.accent));
    setAccentMenuOpen(false);
    setSettings({
      speed: currentVoice?.settings?.speed ?? 1,
      stability: currentVoice?.settings?.stability ?? 0.55,
    });
    setLocalError(null);

    let cancelled = false;
    setLoadingVoices(true);
    listVoices({})
      .then((result) => {
        if (cancelled) return;
        const loaded = result as ElevenLabsVoice[];
        setVoices(loaded);
        if (!currentVoice?.voiceId && loaded.length > 0) {
          setSelectedVoiceId(loaded[0].voiceId);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLocalError(getUserFacingErrorMessage(err, "Could not load ElevenLabs voices."));
      })
      .finally(() => {
        if (!cancelled) setLoadingVoices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentVoice?.accent, currentVoice?.settings?.speed, currentVoice?.settings?.stability, currentVoice?.voiceId, isOpen, listVoices]);

  const filteredVoices = useMemo(
    () => voices.filter((voice) => voiceMatchesAccent(voice, accentFilter)),
    [accentFilter, voices]
  );

  useEffect(() => {
    if (!isOpen || loadingVoices || voices.length === 0) return;
    if (selectedVoiceId && filteredVoices.some((voice) => voice.voiceId === selectedVoiceId)) {
      return;
    }
    setSelectedVoiceId(filteredVoices[0]?.voiceId ?? null);
  }, [filteredVoices, isOpen, loadingVoices, selectedVoiceId, voices.length]);

  const selectedVoice = voices.find((voice) => voice.voiceId === selectedVoiceId) ?? null;
  const selectedAccentLabel = ENGLISH_ACCENTS.find((accent) => accent.value === accentFilter)?.label ?? "All English";
  const auditionLine = auditionText.trim();

  async function playVoice(voice: ElevenLabsVoice) {
    if (!auditionLine || auditioningVoiceId) return;
    setLocalError(null);
    setAuditioningVoiceId(voice.voiceId);
    try {
      const result = await auditionVoice({
        runId,
        voiceId: voice.voiceId,
        text: auditionLine,
        accent: accentFilter,
        settings,
      });
      audioRef.current?.pause();
      const audio = new Audio(`data:${result.contentType};base64,${result.audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => setPlayingVoiceId(null);
      audio.onerror = () => setPlayingVoiceId(null);
      setPlayingVoiceId(voice.voiceId);
      await audio.play();
    } catch (err) {
      setPlayingVoiceId(null);
      setLocalError(getUserFacingErrorMessage(err, "Could not audition that voice."));
    } finally {
      setAuditioningVoiceId(null);
    }
  }

  async function saveVoice() {
    if (!selectedVoice) return;
    onError(null);
    setLocalError(null);
    setSaving(true);
    try {
      await setCourseVoice({
        runId,
        voiceId: selectedVoice.voiceId,
        name: selectedVoice.name,
        accent: accentFilter,
        settings,
      });
      onClose();
    } catch (err) {
      setLocalError(getUserFacingErrorMessage(err, "Could not set the course voice."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="full">
      <ModalBackdrop />
      <ModalContent className="max-h-[86vh] max-w-[860px] rounded-[18px] bg-[#fbfaf6] p-0">
        <ModalHeader className="border-b border-[#dedbd2] px-5 py-4">
          <Box className="min-w-0 flex-1 gap-1">
            <Text className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Narration · ElevenLabs
            </Text>
            <Heading size="md" className="text-[22px] leading-7 tracking-[-0.03em]">
              Choose the course voice
            </Heading>
            <Text className="text-[12px] text-muted-foreground">
              Audition voices on a real course line, then set one voice for the whole course.
            </Text>
          </Box>
          <ModalCloseButton onPress={onClose} className="rounded-full border border-[#dedbd2] bg-white px-3 py-2">
            <Text className="text-[12px] font-bold text-[#514d46]">×</Text>
          </ModalCloseButton>
        </ModalHeader>

        <ModalBody className="m-0 p-0">
          <Box className="border-b border-[#dedbd2] bg-[#0f1b2a] px-5 py-4">
            <Box className="flex-row flex-wrap items-center gap-2">
              <Pill tone="warning" label="Audition line" />
              <Pill tone="neutral" label="Intro line" />
              {selectedVoice ? <Pill tone="neutral" label={selectedVoice.name} /> : null}
            </Box>
            <Text className="mt-3 text-[16px] font-semibold leading-6 text-white">
              {auditionLine || "No narration line is available for audition."}
            </Text>
            <Box className="mt-4 flex-row flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onPress={() => selectedVoice ? void playVoice(selectedVoice) : undefined}
                disabled={!selectedVoice || !auditionLine || auditioningVoiceId !== null}
                className="h-11 rounded-full border-white/30 bg-white/10 px-4"
              >
                <ButtonText className="text-white">
                  {selectedVoice && auditioningVoiceId === selectedVoice.voiceId
                    ? "Generating sample"
                    : selectedVoice && playingVoiceId === selectedVoice.voiceId
                      ? "Playing sample"
                      : "Play selected voice"}
                </ButtonText>
              </Button>
              <Text className="text-[12px] text-white/65">
                {auditionLine.length > 360 ? "Sample capped to 360 characters." : "Real course text, no full TTS run yet."}
              </Text>
            </Box>
          </Box>

          <ScrollView className="max-h-[420px]">
            <Box className="gap-2 p-5">
              <Box className="z-10 mb-2 max-w-[280px] gap-1">
                <Text className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  English accent
                </Text>
                <Pressable
                  onPress={() => setAccentMenuOpen((value) => !value)}
                  className="flex-row items-center justify-between rounded-xl border border-[#dedbd2] bg-white px-3 py-2.5"
                >
                  <Text className="text-[13px] font-bold text-[#1f1d1a]">{selectedAccentLabel}</Text>
                  <Text className="text-[12px] font-bold text-muted-foreground">⌄</Text>
                </Pressable>
                {accentMenuOpen ? (
                  <Box className="overflow-hidden rounded-xl border border-[#dedbd2] bg-white">
                    {ENGLISH_ACCENTS.map((accent) => {
                      const active = accent.value === accentFilter;
                      return (
                        <Pressable
                          key={accent.value}
                          onPress={() => {
                            setAccentFilter(accent.value);
                            setAccentMenuOpen(false);
                          }}
                          className={`flex-row items-center justify-between border-b border-[#ebe8df] px-3 py-2.5 last:border-b-0 ${active ? "bg-[#f0eee8]" : "bg-white"}`}
                        >
                          <Text className="text-[13px] font-semibold text-[#1f1d1a]">{accent.label}</Text>
                          {active ? <Text className="text-[12px] font-bold text-[#1f1d1a]">✓</Text> : null}
                        </Pressable>
                      );
                    })}
                  </Box>
                ) : null}
              </Box>
              {loadingVoices ? (
                <Box className="rounded-xl border border-[#dedbd2] bg-white p-4">
                  <Text className="text-[13px] text-muted-foreground">Loading ElevenLabs voices...</Text>
                </Box>
              ) : voices.length === 0 ? (
                <Box className="rounded-xl border border-[#dedbd2] bg-white p-4">
                  <Text className="text-[13px] text-muted-foreground">No voices returned from ElevenLabs.</Text>
                </Box>
              ) : filteredVoices.length === 0 ? (
                <Box className="rounded-xl border border-[#dedbd2] bg-white p-4">
                  <Text className="text-[13px] text-muted-foreground">
                    No voices matched {selectedAccentLabel}. Try All English or add a matching ElevenLabs voice to the account.
                  </Text>
                </Box>
              ) : (
                filteredVoices.map((voice) => {
                  const selected = voice.voiceId === selectedVoiceId;
                  const courseVoice = currentVoice?.voiceId === voice.voiceId;
                  return (
                    <Pressable
                      key={voice.voiceId}
                      onPress={() => setSelectedVoiceId(voice.voiceId)}
                      className={`flex-row items-center gap-3 rounded-xl border bg-white px-3 py-3 ${
                        selected ? "border-[#1f1d1a]" : "border-[#dedbd2] data-[hover=true]:border-[#bdb8ad]"
                      }`}
                    >
                      <Box className={`h-5 w-5 items-center justify-center rounded-full border ${selected ? "border-[#1f1d1a] bg-[#1f1d1a]" : "border-[#c8c2b6] bg-white"}`}>
                        {selected ? <Text className="text-[11px] font-bold text-white">✓</Text> : null}
                      </Box>
                      <Box className="h-9 w-9 items-center justify-center rounded-full bg-[#182739]">
                        <Text className="text-[15px] font-bold text-white">{voiceInitial(voice.name)}</Text>
                      </Box>
                      <Box className="min-w-0 flex-1 gap-0.5">
                        <Box className="flex-row flex-wrap items-center gap-2">
                          <Text className="text-[14px] font-bold text-[#1f1d1a]">{voice.name}</Text>
                          {courseVoice ? <Pill tone="warning" label="Course voice" /> : null}
                        </Box>
                        <Text className="text-[12px] text-muted-foreground" numberOfLines={1}>
                          {voiceDetail(voice)}
                        </Text>
                      </Box>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!auditionLine || auditioningVoiceId !== null}
                        onPress={() => void playVoice(voice)}
                        className="h-9 rounded-full px-3"
                      >
                        <ButtonText className="text-[12px]">
                          {auditioningVoiceId === voice.voiceId
                            ? "..."
                            : playingVoiceId === voice.voiceId
                              ? "Playing"
                              : "Play"}
                        </ButtonText>
                      </Button>
                    </Pressable>
                  );
                })
              )}
            </Box>
          </ScrollView>

          <Box className="gap-3 border-t border-[#dedbd2] bg-[#f0eee8] px-5 py-4">
            <Box className="flex-row flex-wrap items-center gap-3">
              <Text className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Speed
              </Text>
              {[0.9, 1, 1.1].map((speed) => (
                <Pressable
                  key={`speed-${speed}`}
                  onPress={() => setSettings((current) => ({ ...current, speed }))}
                  className={`rounded-full border px-3 py-1.5 ${settings.speed === speed ? "border-[#1f1d1a] bg-[#1f1d1a]" : "border-[#dedbd2] bg-white"}`}
                >
                  <Text className={`text-[12px] font-bold ${settings.speed === speed ? "text-white" : "text-[#514d46]"}`}>
                    {speed.toFixed(1)}x
                  </Text>
                </Pressable>
              ))}
              <Text className="ml-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Stability
              </Text>
              {[0.35, 0.55, 0.75].map((stability) => (
                <Pressable
                  key={`stability-${stability}`}
                  onPress={() => setSettings((current) => ({ ...current, stability }))}
                  className={`rounded-full border px-3 py-1.5 ${settings.stability === stability ? "border-[#1f1d1a] bg-[#1f1d1a]" : "border-[#dedbd2] bg-white"}`}
                >
                  <Text className={`text-[12px] font-bold ${settings.stability === stability ? "text-white" : "text-[#514d46]"}`}>
                    {Math.round(stability * 100)}
                  </Text>
                </Pressable>
              ))}
              <Text className="ml-auto text-[12px] text-muted-foreground">
                Applies to all units · speed {formatVoiceSetting(settings.speed, 1)}x · stability {Math.round((settings.stability ?? 0.55) * 100)}
              </Text>
            </Box>

            {localError ? (
              <Box className="rounded-xl border border-destructive bg-destructive/10 px-3 py-2">
                <Text className="text-sm text-destructive">{localError}</Text>
              </Box>
            ) : null}

            <Box className="flex-row flex-wrap items-center justify-between gap-2">
              <Button variant="outline" onPress={onClose} disabled={saving} className="rounded-full">
                <ButtonText>Cancel</ButtonText>
              </Button>
              <Button
                onPress={() => void saveVoice()}
                disabled={!selectedVoice || saving || auditioningVoiceId !== null}
                className="rounded-full bg-[#1f1d1a]"
              >
                <ButtonText>
                  {saving
                    ? "Saving voice"
                    : selectedVoice
                      ? `Use ${selectedVoice.name} for this course`
                      : "Choose a voice"}
                </ButtonText>
              </Button>
            </Box>
          </Box>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

function CourseTitleEditor({
  runId,
  title,
  editable,
  onError,
}: {
  runId: Id<"runs">;
  title: string;
  editable: boolean;
  onError: (message: string | null) => void;
}) {
  const updateCourseTitle = useMutation(api.pipeline.courses.adminUpdateCourseTitle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [editing, title]);

  useEffect(() => {
    if (!editable) setEditing(false);
  }, [editable]);

  async function save() {
    if (!editable) return;
    onError(null);
    setBusy(true);
    try {
      await updateCourseTitle({ runId, title: draft });
      setEditing(false);
    } catch (err) {
      onError(getUserFacingErrorMessage(err, "Could not save the course title."));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <Box className="flex-row flex-wrap items-center gap-2">
        <Text className="text-[13px] font-semibold text-[#514d46]">{title}</Text>
        {editable ? (
          <Button size="sm" variant="outline" className="h-7 rounded-full px-2" onPress={() => setEditing(true)}>
            <ButtonText className="text-[11px]">Edit title</ButtonText>
          </Button>
        ) : null}
      </Box>
    );
  }

  return (
    <Box className="max-w-[520px] gap-2">
      <Input className="bg-white">
        <InputField value={draft} onChangeText={setDraft} placeholder="Course title" />
      </Input>
      <Box className="flex-row gap-2">
        <Button size="sm" onPress={() => void save()} disabled={busy || draft.trim().length === 0}>
          <ButtonText>{busy ? "Saving" : "Save title"}</ButtonText>
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onPress={() => setEditing(false)}>
          <ButtonText>Cancel</ButtonText>
        </Button>
      </Box>
    </Box>
  );
}

function Pill({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: { box: "border-[#dedbd2] bg-white", text: "text-[#514d46]" },
    success: { box: "border-[#cde6d5] bg-[#e7f6eb]", text: "text-[#136b35]" },
    warning: { box: "border-[#ead39c] bg-[#fff2cf]", text: "text-[#8b5a08]" },
    danger: { box: "border-[#efc6be] bg-[#fff0ed]", text: "text-[#9f2f23]" },
  }[tone];
  return (
    <Box className={`rounded-full border px-3 py-1 ${toneClass.box}`}>
      <Text className={`text-[12px] font-semibold ${toneClass.text}`}>{label}</Text>
    </Box>
  );
}

function ModuleTitleEditor({
  runId,
  moduleKey,
  title,
  editable,
  onError,
}: {
  runId: Id<"runs"> | undefined;
  moduleKey: string;
  title: string;
  editable: boolean;
  onError: (message: string | null) => void;
}) {
  const updateModuleTitle = useMutation(api.pipeline.courses.adminUpdateModuleTitle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [editing, title]);

  useEffect(() => {
    if (!editable) setEditing(false);
  }, [editable]);

  async function save() {
    if (!runId || !editable) return;
    onError(null);
    setBusy(true);
    try {
      await updateModuleTitle({ runId, moduleKey, title: draft });
      setEditing(false);
    } catch (err) {
      onError(getUserFacingErrorMessage(err, "Could not save the module title."));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <Box className="flex-row items-center gap-1 px-1">
        <Text className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground" numberOfLines={2}>
          {title}
        </Text>
        {editable ? (
          <Pressable disabled={!runId} onPress={() => setEditing(true)} className="rounded-full border border-[#dedbd2] bg-white px-2 py-0.5">
            <Text className="text-[10px] font-semibold text-[#514d46]">Edit</Text>
          </Pressable>
        ) : null}
      </Box>
    );
  }

  return (
    <Box className="gap-1 px-1">
      <Input className="bg-white">
        <InputField value={draft} onChangeText={setDraft} placeholder="Module title" />
      </Input>
      <Box className="flex-row gap-1">
        <Button size="sm" onPress={() => void save()} disabled={busy || !editable || !runId || draft.trim().length === 0} className="h-7 px-2">
          <ButtonText className="text-[11px]">{busy ? "Saving" : "Save"}</ButtonText>
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onPress={() => setEditing(false)} className="h-7 px-2">
          <ButtonText className="text-[11px]">Cancel</ButtonText>
        </Button>
      </Box>
    </Box>
  );
}

function UnitQueuePanel({
  modules,
  runId,
  selectedUnit,
  sendBackIds,
  onSelect,
  onToggleSendBack,
  editable,
  onError,
}: {
  modules: Array<{ moduleKey: string; title: string; units: Doc<"microUnits">[] }>;
  runId: Id<"runs"> | undefined;
  selectedUnit: Doc<"microUnits"> | null;
  sendBackIds: Set<Id<"microUnits">>;
  onSelect: (unitId: Id<"microUnits">) => void;
  onToggleSendBack: (unitId: Id<"microUnits">) => void;
  editable: boolean;
  onError: (message: string | null) => void;
}) {
  const totalUnits = modules.reduce((sum, module) => sum + module.units.length, 0);
  return (
    <Box className="min-h-0 shrink-0 flex-col border-b border-[#dedbd2] bg-[#f0eee8] xl:w-[270px] xl:border-b-0 xl:border-r">
      <Box className="border-b border-[#dedbd2] px-4 py-4">
        <Text className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Unit queue · {totalUnits}
        </Text>
        <Text className="mt-1 text-[12px] leading-4 text-muted-foreground">
          Select a unit to inspect. Mark units to send back for re-authoring.
        </Text>
      </Box>
      <ScrollView className="min-h-0 flex-1 max-h-[320px] xl:max-h-none">
        <Box className="gap-4 p-3">
          {modules.map((module) => (
            <Box key={module.moduleKey} className="gap-1.5">
                <ModuleTitleEditor
                  runId={runId}
                  moduleKey={module.moduleKey}
                  title={module.title}
                  editable={editable}
                  onError={onError}
                />
              {module.units.map((unit) => (
                <UnitRailRow
                  key={unit._id}
                  unit={unit}
                  selected={selectedUnit?._id === unit._id}
                  markedForSendBack={sendBackIds.has(unit._id)}
                  editable={editable}
                  onSelect={() => onSelect(unit._id)}
                  onToggleSendBack={() => onToggleSendBack(unit._id)}
                />
              ))}
            </Box>
          ))}
        </Box>
      </ScrollView>
    </Box>
  );
}

function unitIssueCount(unit: Doc<"microUnits">): number {
  const qa = unit.qa as UnitQa | undefined;
  const meta = unit.meta as UnitMeta;
  return (qa?.flags.length ?? 0) + (meta.complianceWarnings ?? []).length;
}

function unitOrderLabel(unit: Doc<"microUnits">): string {
  const meta = unit.meta as UnitMeta;
  return `${meta.order.module + 1}.${meta.order.unit + 1}`;
}

function sentenceLabel(id: string): string {
  const match = id.match(/^n(\d+)$/i);
  return match ? `Sentence ${Number(match[1])}` : "Sentence";
}

function narrationParagraphs(
  narration: NarrationSentence[],
  cards: UnitCard[]
): NarrationParagraph[] {
  const sentenceIndexById = new Map(
    narration.map((sentence, index) => [sentence.id, index])
  );
  const breakPoints = new Set<string>(["0:0"]);

  for (const card of cards) {
    const sentenceIndex = sentenceIndexById.get(card.enterAt.narration);
    if (sentenceIndex === undefined) continue;
    const sentence = narration[sentenceIndex];
    const wordIndex = sentence.text
      .toLocaleLowerCase()
      .indexOf(card.enterAt.word.toLocaleLowerCase());
    if (wordIndex > 0) breakPoints.add(`${sentenceIndex}:${wordIndex}`);
    if (wordIndex === 0 && sentenceIndex > 0) breakPoints.add(`${sentenceIndex}:0`);
  }

  const paragraphs: NarrationParagraph[] = [[]];
  for (const [sentenceIndex, sentence] of narration.entries()) {
    const points = [...breakPoints]
      .map((value) => value.split(":").map(Number))
      .filter(([index]) => index === sentenceIndex)
      .map(([, offset]) => offset)
      .filter((offset) => offset > 0 && offset < sentence.text.length)
      .sort((a, b) => a - b);
    const segments = [0, ...points, sentence.text.length];

    for (let index = 0; index < segments.length - 1; index += 1) {
      const start = segments[index];
      if (breakPoints.has(`${sentenceIndex}:${start}`) && paragraphs.at(-1)?.length) {
        paragraphs.push([]);
      }
      const text = sentence.text.slice(start, segments[index + 1]);
      if (text) paragraphs.at(-1)?.push({ sentence, text });
    }

    if (sentenceIndex < narration.length - 1) {
      paragraphs.at(-1)?.push({ sentence, text: " " });
    }
  }

  return paragraphs.filter((paragraph) => paragraph.some((chunk) => chunk.text.trim()));
}

function cardIndexForFlag(flag: JudgeFlag, cardCount: number): number | null {
  const zeroBased = flag.message.match(/\bcard\s+index\s+(\d+)\b/i);
  if (zeroBased) {
    const index = Number(zeroBased[1]);
    return index >= 0 && index < cardCount ? index : null;
  }

  const oneBased = flag.message.match(/\bcard\s+(\d+)\b/i);
  if (oneBased) {
    const index = Number(oneBased[1]) - 1;
    return index >= 0 && index < cardCount ? index : null;
  }
  return null;
}

function flagsByCardIndex(cards: UnitCard[], flags: JudgeFlag[]): Map<number, JudgeFlag[]> {
  const result = new Map<number, JudgeFlag[]>();
  for (const flag of flags) {
    const index = cardIndexForFlag(flag, cards.length);
    if (index === null) continue;
    result.set(index, [...(result.get(index) ?? []), flag]);
  }
  return result;
}

function displayIdentifier(value: string): string {
  return value
    .replace(/^(q-)?mu-[0-9]+-/i, "")
    .replace(/^q-/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Question";
}

function questionLabelForId(
  questionId: string,
  meta: UnitMeta,
  questionsById?: Map<string, Doc<"questions">>
): string {
  if (questionId === meta.hook.questionRef) return "hook question";
  const retrieveIndex = meta.retrieve.indexOf(questionId);
  if (retrieveIndex >= 0) return `retrieval question ${retrieveIndex + 1}`;

  const body = questionsById?.get(questionId)?.body as QuestionBody | undefined;
  if (body?.type === "commit") return "hook question";
  if (body?.type === "mcq") return "retrieval question";

  const generatedRetrieve = questionId.match(/-r(\d+)$/i);
  if (generatedRetrieve) return `retrieval question ${Number(generatedRetrieve[1])}`;
  if (/-h$/i.test(questionId)) return "hook question";
  return displayIdentifier(questionId).toLowerCase();
}

function humanizeGeneratedIds(
  text: string,
  meta: UnitMeta,
  questionsById: Map<string, Doc<"questions">>
): string {
  let output = text;
  const knownIds = [...new Set([...questionsById.keys(), meta.hook.questionRef, ...meta.retrieve])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const id of knownIds) {
    output = output.replaceAll(id, questionLabelForId(id, meta, questionsById));
  }
  return humanizeTechnicalIds(
    output.replace(/\bq-mu-[a-z0-9-]+\b/gi, (id) => questionLabelForId(id, meta, questionsById))
  );
}

function humanizeTechnicalIds(text: string): string {
  return text
    .replace(/\bq-mu-[a-z0-9-]+\b/gi, "question")
    .replace(/\bmu-(\d)(\d{2})\b/gi, (_id, moduleNumber: string, unitNumber: string) => {
      return `unit ${Number(moduleNumber)}.${Number(unitNumber)}`;
    })
    .replace(/\bn(\d+)\b/gi, (_id, sentenceNumber: string) => `sentence ${Number(sentenceNumber)}`);
}

function questionCardLabel(
  row: Doc<"questions">,
  meta: UnitMeta,
  questionsById: Map<string, Doc<"questions">>
): string {
  const body = row.body as QuestionBody;
  const questionLabel = questionLabelForId(body.id, meta, questionsById);
  return `${questionLabel.replace(/^\w/, (letter) => letter.toUpperCase())} · ${displayIdentifier(body.conceptTag)}`;
}

function cardTemplateLabel(template: string): string {
  const names: Record<string, string> = {
    "alert-card": "Alert card",
    "breakdown-card": "Breakdown card",
    "chart-card": "Chart card",
    "checklist-card": "Checklist card",
    "comparison-split": "Comparison card",
    "date-card": "Date card",
    "document-callout": "Document card",
    "image-text-card": "Image and text card",
    "list-reveal": "List card",
    "map-card": "Map card",
    "myth-fact-card": "Myth/fact card",
    "pathway-card": "Pathway card",
    "persona-card": "Persona card",
    "photo-kenburns": "Photo card",
    "quote-card": "Quote card",
    "stat-card": "Stat card",
    "takeaway-card": "Takeaway card",
    "term-card": "Term card",
    "text-card": "Text card",
    "timeline-card": "Timeline card",
    "title-card": "Title card",
    "video-card": "Video card",
  };
  return names[template] ?? displayIdentifier(template);
}

function titleCaseLabel(value: string): string {
  const words = value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().split(" ");
  const smallWords = new Set(["and", "as", "at", "for", "in", "of", "on", "or", "the", "to", "with"]);
  const acronyms = new Set(["CDU", "OSHC", "ATAR", "VET", "IELTS", "TOEFL"]);
  return words
    .map((word, index) => {
      const upper = word.toUpperCase();
      const lower = word.toLowerCase();
      if (acronyms.has(upper)) return upper;
      if (index > 0 && smallWords.has(lower)) return lower;
      return lower.replace(/^\w/, (letter) => letter.toUpperCase());
    })
    .join(" ");
}

function moduleDisplayTitle(value: string | undefined): string {
  const raw = value?.trim();
  return raw ? titleCaseLabel(raw) : "Module";
}

function stringProp(props: Record<string, unknown>, key: string): string | null {
  const value = props[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function unitDisplayTitle(unit: Doc<"microUnits">): string {
  const cards = (unit.cards ?? []) as UnitCard[];
  const titleCard = cards.find((card) => card.template === "title-card");
  const title = titleCard ? stringProp(titleCard.props, "title") : null;
  if (title) return title;
  const firstNamedCard = cards.find((card) => stringProp(card.props, "title") || stringProp(card.props, "heading"));
  const fallbackTitle = firstNamedCard
    ? stringProp(firstNamedCard.props, "title") ?? stringProp(firstNamedCard.props, "heading")
    : null;
  return fallbackTitle ?? displayIdentifier(unit.concept);
}

type CardPropPath = Array<string | number>;

interface EditableCardTextField {
  path: CardPropPath;
  label: string;
  value: string;
  multiline: boolean;
}

const TECHNICAL_CARD_PROP_KEYS = new Set([
  "assetRef",
  "imageRef",
  "bgAssetRef",
  "bgTreatment",
  "panDirection",
]);

function collectEditableCardTextFields(
  value: unknown,
  path: CardPropPath = []
): EditableCardTextField[] {
  if (typeof value === "string") {
    const last = path[path.length - 1];
    if (typeof last === "string" && TECHNICAL_CARD_PROP_KEYS.has(last)) return [];
    return [
      {
        path,
        label: cardPropPathLabel(path),
        value,
        multiline: value.length > 70 || /body|text|quote|excerpt|definition|message|fact|myth|note/i.test(String(last)),
      },
    ];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectEditableCardTextFields(entry, [...path, index])
    );
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, entry]) =>
      collectEditableCardTextFields(entry, [...path, key])
    );
  }
  return [];
}

function cardPropPathLabel(path: CardPropPath): string {
  return path
    .map((segment) =>
      typeof segment === "number"
        ? `${segment + 1}`
        : segment
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/[-_]+/g, " ")
            .replace(/^\w/, (letter) => letter.toUpperCase())
    )
    .join(" · ");
}

function setCardPropAtPath(
  current: unknown,
  path: CardPropPath,
  value: string
): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(current) && typeof head === "number") {
    const next = [...current];
    next[head] = setCardPropAtPath(next[head], rest, value);
    return next;
  }
  if (isRecord(current) && typeof head === "string") {
    return {
      ...current,
      [head]: setCardPropAtPath(current[head], rest, value),
    };
  }
  return current;
}

function provenanceLabel(value: string): string {
  if (value === "compiler:derived") return "Compiler-derived";
  if (value.startsWith("compiler:")) return `Compiler: ${displayIdentifier(value.slice("compiler:".length))}`;
  if (value.startsWith("doc:")) return "Source document";
  return displayIdentifier(value);
}

function UnitRailRow({
  unit,
  selected,
  markedForSendBack,
  editable,
  onSelect,
  onToggleSendBack,
}: {
  unit: Doc<"microUnits">;
  selected: boolean;
  markedForSendBack: boolean;
  editable: boolean;
  onSelect: () => void;
  onToggleSendBack: () => void;
}) {
  const issues = unitIssueCount(unit);
  const judged = unit.qa !== undefined;
  return (
    <Box className="flex-row items-center gap-2">
      <Pressable
        className={`min-h-9 flex-1 flex-row items-center gap-2 rounded-xl border px-2.5 py-2 ${
          selected
            ? "border-[#2e2c28] bg-white"
            : "border-transparent bg-transparent data-[hover=true]:bg-white/70"
        }`}
        onPress={onSelect}
      >
        <Text className="w-8 text-[13px] font-semibold text-[#6e675c]" numberOfLines={1}>
          {unitOrderLabel(unit)}
        </Text>
        <Text className="min-w-0 flex-1 text-[13px] text-[#514d46]" numberOfLines={1}>
          {unitDisplayTitle(unit)}
        </Text>
        {!judged ? (
          <Text className="text-xs text-muted-foreground">-</Text>
        ) : issues > 0 ? (
          <Box className="min-w-6 items-center rounded-full bg-[#f6dfaa] px-1.5 py-0.5">
            <Text className="text-[11px] font-bold text-[#8b5a08]">{issues}</Text>
          </Box>
        ) : (
          <Text className="text-xs font-bold text-[#2c8a4b]">✓</Text>
        )}
      </Pressable>
      <Pressable
        disabled={!editable}
        onPress={onToggleSendBack}
        className={`h-6 w-6 items-center justify-center rounded-full border ${!editable ? "opacity-40" : ""} ${
          markedForSendBack
            ? "border-[#9f2f23] bg-[#9f2f23]"
            : "border-transparent bg-transparent data-[hover=true]:border-[#dedbd2]"
        }`}
      >
        {markedForSendBack ? (
          <Text className="text-[11px] font-bold text-white">↩</Text>
        ) : null}
      </Pressable>
    </Box>
  );
}

function FlagRow({ flag }: { flag: JudgeFlag }) {
  const dangerous = flag.severity === "error";
  return (
    <Box
      className={`rounded-lg border px-3 py-2 ${
        dangerous
          ? "border-[#efc6be] bg-[#fff0ed]"
          : "border-[#ead39c] bg-[#fff7e3]"
      }`}
    >
      <Text
        className={`text-xs font-semibold ${
          dangerous ? "text-[#9f2f23]" : "text-[#8b5a08]"
        }`}
      >
        {humanizeTechnicalIds(flag.code)}: {humanizeTechnicalIds(flag.message)}
      </Text>
    </Box>
  );
}

const SCRIPT_CLASSIFICATION_STYLES: Record<
  SentenceClassification["classification"],
  { legend: string; highlight: string }
> = {
  traced: { legend: "bg-[#9acbae]", highlight: "rounded-[3px] bg-[#e7f3eb] px-0.5" },
  unsupported: { legend: "bg-[#d5b33b]", highlight: "rounded-[3px] bg-[#fff1bd] px-0.5" },
  derived: { legend: "bg-[#d4d3cc]", highlight: "rounded-[3px] bg-[#efeee9] px-0.5" },
};

function ScriptLegend({
  label,
  classification,
}: {
  label: string;
  classification: SentenceClassification["classification"];
}) {
  const style = SCRIPT_CLASSIFICATION_STYLES[classification];
  return (
    <Box className="flex-row items-center gap-1.5">
      <Box className={`h-2.5 w-2.5 rounded-sm ${style.legend}`} />
      <Text className="text-[11px] text-[#716d65]">{label}</Text>
    </Box>
  );
}

function NarrationReviewCallout({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <Box className="rounded-xl border border-[#ead39c] bg-[#fffaf0] px-3 py-2.5">
      <Box className="flex-row items-start gap-2">
        <Box className="mt-0.5 h-4 w-4 items-center justify-center rounded-full bg-[#b97708]">
          <Text className="text-[10px] font-bold text-white">!</Text>
        </Box>
        <Text className="min-w-0 flex-1 text-[12px] leading-5 text-[#735b2c]">
          <Text className="font-bold">{title} - </Text>
          {message}
        </Text>
      </Box>
    </Box>
  );
}

function UnitDetail({
  unit,
  runId,
  questionsById,
  markedForSendBack,
  onToggleSendBack,
  editable,
  presentation,
  onError,
}: {
  unit: Doc<"microUnits">;
  runId: Id<"runs">;
  questionsById: Map<string, Doc<"questions">>;
  markedForSendBack: boolean;
  onToggleSendBack: () => void;
  editable: boolean;
  presentation?: unknown;
  onError: (message: string | null) => void;
}) {
  const meta = unit.meta as UnitMeta;
  const qa = unit.qa as UnitQa | undefined;
  const narration = (unit.narration ?? []) as NarrationSentence[];
  const cards = (unit.cards ?? []) as UnitCard[];
  const updateNarration = useMutation(api.pipeline.tts.edit.adminUpdateNarrationSentence);
  const [editingNarrationId, setEditingNarrationId] = useState<string | null>(null);
  const [narrationDraft, setNarrationDraft] = useState("");
  const [savingNarration, setSavingNarration] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const classificationById = new Map(
    (qa?.sentenceClassifications ?? []).map((entry) => [
      entry.narrationId,
      entry,
    ])
  );
  const narrationScript = narration
    .map((sentence) => sentence.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const paragraphs = narrationParagraphs(narration, cards);
  const narrationIssues = (qa?.sentenceClassifications ?? []).filter(
    (classification) => classification.classification === "unsupported"
  );
  const narrationReviewCount = narrationIssues.length;
  const hookRow = questionsById.get(meta.hook.questionRef);
  const retrieveRows = meta.retrieve
    .map((ref) => questionsById.get(ref))
    .filter((row): row is Doc<"questions"> => row !== undefined);
  useEffect(() => {
    setEditingNarrationId(null);
    setNarrationDraft("");
    setScriptCopied(false);
  }, [unit._id]);

  useEffect(() => {
    if (!editable) {
      setEditingNarrationId(null);
      setNarrationDraft("");
    }
  }, [editable]);

  function startNarrationEdit(sentence: NarrationSentence) {
    if (!editable) return;
    setEditingNarrationId(sentence.id);
    setNarrationDraft(sentence.text);
    onError(null);
  }

  async function saveNarrationEdit() {
    if (!editingNarrationId || !editable) return;
    onError(null);
    setSavingNarration(true);
    try {
      await updateNarration({
        runId,
        unitId: unit._id,
        narrationId: editingNarrationId,
        text: narrationDraft,
      });
      setEditingNarrationId(null);
      setNarrationDraft("");
    } catch (err) {
      onError(getUserFacingErrorMessage(err, "Could not save narration."));
    } finally {
      setSavingNarration(false);
    }
  }

  async function copyNarrationScript() {
    if (!narrationScript) return;
    onError(null);
    try {
      const nav = (globalThis as { navigator?: Navigator }).navigator;
      if (!nav?.clipboard) {
        onError("Copy is only available in a supported browser.");
        return;
      }
      await nav.clipboard.writeText(narrationScript);
      setScriptCopied(true);
    } catch {
      setScriptCopied(false);
      onError("Could not copy narration script.");
    }
  }

  return (
    <Box className="mx-auto w-full max-w-[760px] gap-4 p-4 md:p-6">
      <Box className="flex-row flex-wrap items-start justify-between gap-3">
        <Box className="min-w-[220px] flex-1 gap-1">
          <Box className="flex-row flex-wrap items-center gap-2">
            <Heading size="md" className="text-[21px] leading-7 tracking-[-0.03em]">
              {unitDisplayTitle(unit)}
            </Heading>
            <Pill tone="neutral" label={unitOrderLabel(unit)} />
            <Pill tone="neutral" label={unit.state} />
          </Box>
          <Text className="text-[13px] text-muted-foreground">
            module: {moduleDisplayTitle(unit.moduleTitle ?? unit.moduleKey)} · concept: {displayIdentifier(meta.conceptKey ?? unit.concept)} · {meta.secondsBudget}s budget · state: {unit.state}
          </Text>
        </Box>
        <Button size="sm" variant="outline" className="rounded-full" disabled={!editable} onPress={onToggleSendBack}>
          <ButtonText>
            {markedForSendBack ? "↩ Marked to send back" : "↩ Mark to send back"}
          </ButtonText>
        </Button>
      </Box>

      <AvatarPresentationPanel
        runId={runId}
        presentation={presentation}
        unit={{ unitKey: unit.unitKey, concept: unit.concept }}
        editable={editable}
        onError={onError}
      />

      <Box className="overflow-hidden rounded-2xl border border-[#dedbd2] bg-white">
        <Box className="flex-row flex-wrap items-center justify-between gap-2 border-b border-[#ebe8df] px-4 py-3">
          <Box className="flex-row flex-wrap items-baseline gap-2">
            <Text className="text-[15px] font-bold text-[#1f1d1a]">Narration</Text>
            <Text className="font-mono text-[11px] text-[#716d65]">
              script · {narration.length} sentence{narration.length === 1 ? "" : "s"}
            </Text>
          </Box>
          {narrationReviewCount > 0 ? (
            <Box className="flex-row items-center gap-2 rounded-full bg-[#faf0cf] px-2.5 py-1">
              <Text className="text-[11px] font-bold text-[#8b5a08]">
                {narrationReviewCount} needs review
              </Text>
              <Text className="text-[10px] font-bold text-[#8b5a08]">⌄</Text>
            </Box>
          ) : (
            <Box className="rounded-full bg-[#e8f4eb] px-2.5 py-1">
              <Text className="text-[11px] font-bold text-[#2c7a43]">Reviewed</Text>
            </Box>
          )}
        </Box>
        <Box className="flex-row flex-wrap items-center justify-between gap-3 border-b border-[#ebe8df] bg-[#fcfbf8] px-4 py-3">
          <Box className="flex-row flex-wrap items-center gap-4">
            <ScriptLegend label="Traced" classification="traced" />
            <ScriptLegend label="Flagged" classification="unsupported" />
            <ScriptLegend label="Derived" classification="derived" />
          </Box>
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-full px-3"
            disabled={!narrationScript}
            onPress={() => void copyNarrationScript()}
          >
            <ButtonText className="text-[11px]">
              {scriptCopied ? "Copied" : "Copy script"}
            </ButtonText>
          </Button>
        </Box>
        <Box className="gap-4 p-4">
          {editingNarrationId ? (
            narration.map((sentence) => {
              const isEditing = editingNarrationId === sentence.id;
              const brokenAnchors = isEditing
                ? cards
                    .map((card, index) => ({ card, index }))
                    .filter(
                      ({ card }) =>
                        card.enterAt.narration === sentence.id &&
                        !narrationDraft.includes(card.enterAt.word)
                    )
                : [];
              const classification = classificationById.get(sentence.id);
              const style = SCRIPT_CLASSIFICATION_STYLES[
                classification?.classification ?? "derived"
              ];
              return isEditing ? (
                <Box key={sentence.id} className="gap-2">
                  <Textarea className="bg-white">
                    <TextareaInput
                      value={narrationDraft}
                      onChangeText={setNarrationDraft}
                      multiline
                      numberOfLines={4}
                      placeholder="Narration sentence"
                    />
                  </Textarea>
                  {brokenAnchors.length > 0 ? (
                    <Text className="text-xs text-destructive">
                      Keep card anchor word{brokenAnchors.length > 1 ? "s" : ""} {brokenAnchors.map(({ card, index }) => `#${index + 1} "${card.enterAt.word}"`).join(", ")} or update the card beat in preview.
                    </Text>
                  ) : null}
                  <Box className="flex-row gap-2">
                    <Button
                      size="sm"
                      onPress={() => void saveNarrationEdit()}
                      disabled={!editable || savingNarration || narrationDraft.trim().length === 0 || brokenAnchors.length > 0}
                    >
                      <ButtonText>{savingNarration ? "Saving" : "Save"}</ButtonText>
                    </Button>
                    <Button size="sm" variant="outline" disabled={savingNarration} onPress={() => setEditingNarrationId(null)}>
                      <ButtonText>Cancel</ButtonText>
                    </Button>
                  </Box>
                </Box>
              ) : (
                <Text key={sentence.id} className={`text-[15px] leading-7 text-[#24231f] ${style.highlight}`}>
                  {sentence.text}
                </Text>
              );
            })
          ) : (
            paragraphs.map((paragraph, paragraphIndex) => (
              <Text
                key={`paragraph-${paragraphIndex}`}
                className="text-[15px] leading-7 text-[#24231f]"
              >
                {paragraph.map((chunk, chunkIndex) => {
                  const classification = classificationById.get(chunk.sentence.id);
                  const style = SCRIPT_CLASSIFICATION_STYLES[
                    classification?.classification ?? "derived"
                  ];
                  if (!chunk.text.trim()) return chunk.text;
                  return (
                    <Text
                      key={`${chunk.sentence.id}-${chunkIndex}`}
                      className={style.highlight}
                      onPress={editable ? () => startNarrationEdit(chunk.sentence) : undefined}
                    >
                      {chunk.text}
                    </Text>
                  );
                })}
              </Text>
            ))
          )}
          {narrationIssues.map((classification) => (
            <NarrationReviewCallout
              key={`narration-${classification.narrationId}`}
              title="Flagged narration"
              message={
                classification.note ??
                "This narration sentence includes a claim that needs verification."
              }
            />
          ))}
        </Box>
      </Box>

      {hookRow ? (
        <Box className="gap-2">
          <Text className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Hook question
          </Text>
          <QuestionCard
            row={hookRow}
            label={questionCardLabel(hookRow, meta, questionsById)}
            runId={runId}
            editable={editable}
            onError={onError}
          />
        </Box>
      ) : null}

      {retrieveRows.length > 0 ? (
        <Box className="gap-2">
          <Text className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Retrieve questions
          </Text>
          {retrieveRows.map((row) => (
            <QuestionCard
              key={row._id}
              row={row}
              label={questionCardLabel(row, meta, questionsById)}
              runId={runId}
              editable={editable}
              onError={onError}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function CardDeckPanel({
  unit,
  runId,
  resolveAssetRef,
  brandTokens,
  presentation,
  editable,
  onError,
}: {
  unit: Doc<"microUnits">;
  runId: Id<"runs">;
  resolveAssetRef: (ref: string) => string | null;
  brandTokens?: unknown;
  presentation?: unknown;
  editable: boolean;
  onError: (message: string | null) => void;
}) {
  const meta = unit.meta as UnitMeta;
  const cards = (unit.cards ?? []) as UnitCard[];
  const qa = unit.qa as UnitQa | undefined;
  const flaggedCards = flagsByCardIndex(cards, qa?.flags ?? []);
  const avatarLook = avatarLookForUnit(presentation, unit.unitKey);
  const avatarPreviewImageUrl =
    typeof avatarLook?.previewImageUrl === "string"
      ? avatarLook.previewImageUrl
      : null;
  const avatarMode = isRecord(presentation) && presentation.mode === "avatar";
  const presenterCards = cards.filter(
    (card) => card.visualTreatment === "avatar-overlay"
  ).length;
  const brollCards = cards.filter((card) => card.template === "video-card").length;
  const contentCards = cards.length - presenterCards - brollCards;
  const [editingAnchor, setEditingAnchor] = useState(false);
  useEffect(() => {
    if (!editable) setEditingAnchor(false);
  }, [editable]);
  return (
    <Box className="min-h-0 shrink-0 flex-col border-t border-[#dedbd2] bg-[#f0eee8] xl:w-[300px] xl:border-l xl:border-t-0">
      <Box className="border-b border-[#dedbd2] px-4 py-4">
        <Text className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Card deck · {cards.length}
        </Text>
        <Text className="mt-1 text-[12px] leading-4 text-muted-foreground">
          Toggle eligible cards between presenter video and full-screen content.
        </Text>
        <Box className="mt-2 flex-row flex-wrap gap-1.5">
          {avatarMode ? <Pill tone="neutral" label={`${presenterCards} presenter`} /> : null}
          <Pill tone="neutral" label={`${contentCards} content`} />
          {brollCards > 0 ? <Pill tone="neutral" label={`${brollCards} b-roll`} /> : null}
        </Box>
      </Box>
      <ScrollView className="min-h-0 flex-1 max-h-[520px] xl:max-h-none">
        <Box className="gap-3 p-4">
          {flaggedCards.size > 0 ? (
            <Box className="gap-2 rounded-xl border border-[#ead39c] bg-[#fffaf0] p-3">
              <Box className="flex-row items-center justify-between gap-2">
                <Text className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8b5a08]">
                  Flagged cards
                </Text>
                <Box className="rounded-full bg-[#fff0c7] px-2 py-0.5">
                  <Text className="text-[10px] font-bold text-[#8b5a08]">
                    {flaggedCards.size}
                  </Text>
                </Box>
              </Box>
              {[...flaggedCards.entries()].map(([index, flags]) => (
                <FlaggedCardRow
                  key={`flagged-card-${index}`}
                  card={cards[index]}
                  index={index}
                  flags={flags}
                  resolveAssetRef={resolveAssetRef}
                  brandTokens={brandTokens}
                  avatarPreviewImageUrl={avatarPreviewImageUrl}
                />
              ))}
            </Box>
          ) : null}

          <Text className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            All cards
          </Text>
          {cards.map((card, index) => (
            <CardDeckRow
              key={`card-${index}`}
              card={card}
              index={index}
              runId={runId}
              unitId={unit._id}
              resolveAssetRef={resolveAssetRef}
              brandTokens={brandTokens}
              avatarPreviewImageUrl={avatarPreviewImageUrl}
              avatarMode={avatarMode}
              flagged={flaggedCards.has(index)}
              editable={editable}
              onError={onError}
            />
          ))}

          <Box className="mt-2 gap-2 overflow-hidden rounded-xl border border-[#dedbd2] bg-white p-3">
            <Text className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Anchor
            </Text>
            <Box className="flex-row gap-3">
              <Box
                className="shrink-0 overflow-hidden rounded-lg border border-[#ebe8df]"
                style={{ width: 92, height: 164 } as never}
              >
                <CardStaticPreview
                  template={meta.anchor.template}
                  props={meta.anchor.props}
                  brandTokens={brandTokens}
                  resolveAssetRef={resolveAssetRef}
                  showControls={false}
                  visualTreatment="standard"
                />
              </Box>
              <Box className="min-w-0 flex-1 gap-1">
                <Text className="text-[13px] font-bold text-[#1f1d1a]" numberOfLines={1}>
                  {cardTemplateLabel(meta.anchor.template)}
                </Text>
                {backgroundVariantForCard(meta.anchor.props) ? (
                  <Pill
                    tone="neutral"
                    label={`bg media · ${backgroundVariantForCard(meta.anchor.props)?.treatment}`}
                  />
                ) : null}
                <Box className="mt-1 flex-row">
                  {editable ? (
                    <Button size="sm" variant="outline" className="h-7 rounded-full px-2" onPress={() => setEditingAnchor((value) => !value)}>
                      <ButtonText className="text-[11px]">
                        {editingAnchor ? "Close fields" : "Edit content"}
                      </ButtonText>
                    </Button>
                  ) : null}
                </Box>
              </Box>
            </Box>
            {editingAnchor ? (
              <AnchorContentEditor
                runId={runId}
                unitId={unit._id}
                template={meta.anchor.template}
                props={meta.anchor.props}
                onSaved={() => setEditingAnchor(false)}
                onCancel={() => setEditingAnchor(false)}
                editable={editable}
                onError={onError}
              />
            ) : null}
          </Box>
          {avatarMode ? (
            <Box className="rounded-xl border border-dashed border-[#d8d4ca] bg-[#f8f6f0] p-3">
              <Text className="text-[10px] leading-4 text-muted-foreground">
                The title opens over the presenter by default. Switch eligible cards between Presenter and Content, then approve the course.
              </Text>
            </Box>
          ) : null}
        </Box>
      </ScrollView>
    </Box>
  );
}

function FlaggedCardRow({
  card,
  index,
  flags,
  resolveAssetRef,
  brandTokens,
  avatarPreviewImageUrl,
}: {
  card: UnitCard;
  index: number;
  flags: JudgeFlag[];
  resolveAssetRef: (ref: string) => string | null;
  brandTokens?: unknown;
  avatarPreviewImageUrl?: string | null;
}) {
  return (
    <Box className="gap-2 rounded-lg border border-[#ead39c] bg-white p-2.5">
      <Box className="flex-row gap-2.5">
        <Box
          className="shrink-0 overflow-hidden rounded-md border border-[#ebe8df]"
          style={{ width: 62, height: 110 } as never}
        >
          <CardStaticPreview
            template={card.template}
            props={card.props}
            brandTokens={brandTokens}
            resolveAssetRef={resolveAssetRef}
            showControls={false}
            visualTreatment={card.visualTreatment}
            avatarPreviewImageUrl={avatarPreviewImageUrl}
          />
        </Box>
        <Box className="min-w-0 flex-1 gap-1">
          <Text className="text-[12px] font-bold text-[#1f1d1a]" numberOfLines={1}>
            Card {index + 1} · {cardTemplateLabel(card.template)}
          </Text>
          {flags.map((flag, flagIndex) => (
            <Text key={`flag-${flagIndex}`} className="text-[11px] leading-4 text-[#735b2c]">
              {humanizeTechnicalIds(flag.message)}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function CardDeckRow({
  card,
  index,
  runId,
  unitId,
  resolveAssetRef,
  brandTokens,
  avatarPreviewImageUrl,
  avatarMode,
  flagged,
  editable,
  onError,
}: {
  card: UnitCard;
  index: number;
  runId: Id<"runs">;
  unitId: Id<"microUnits">;
  resolveAssetRef: (ref: string) => string | null;
  brandTokens?: unknown;
  avatarPreviewImageUrl?: string | null;
  avatarMode: boolean;
  flagged: boolean;
  editable: boolean;
  onError: (message: string | null) => void;
}) {
  const backgroundVariant = backgroundVariantForCard(card.props);
  const setVisualTreatment = useMutation(
    api.pipeline.tts.edit.adminSetCardVisualTreatment
  );
  const [editingContent, setEditingContent] = useState(false);
  const [savingTreatment, setSavingTreatment] = useState(false);
  const isBroll = card.template === "video-card";
  const overlayEligible = avatarMode && supportsAvatarOverlay(card.template);
  const titleLocked = overlayEligible && index === 0 && card.template === "title-card";
  const treatment = isBroll
    ? "b-roll"
    : card.visualTreatment === "avatar-overlay"
      ? "presenter"
      : "content";
  useEffect(() => {
    if (!editable) setEditingContent(false);
  }, [editable]);
  return (
    <Box
      className={`gap-2 rounded-xl border bg-white p-3 ${
        flagged ? "border-[#ead39c]" : "border-[#dedbd2]"
      }`}
    >
      <Box className="flex-row gap-3">
        <Box
          className="shrink-0 overflow-hidden rounded-lg border border-[#ebe8df]"
          style={{ width: 92, height: 164 } as never}
        >
          <CardStaticPreview
            template={card.template}
            props={card.props}
            brandTokens={brandTokens}
            resolveAssetRef={resolveAssetRef}
            showControls={false}
            visualTreatment={card.visualTreatment}
            avatarPreviewImageUrl={avatarPreviewImageUrl}
          />
        </Box>
        <Box className="min-w-0 flex-1 gap-1">
          <Box className="flex-row items-start gap-2">
            <Text className="flex-1 text-[13px] font-bold text-[#1f1d1a]" numberOfLines={1}>
              {index + 1} · {cardTemplateLabel(card.template)}
            </Text>
            {backgroundVariant ? (
              <Box className="rounded-full bg-[#fff2cf] px-1.5 py-0.5">
                <Text className="text-[9px] font-bold uppercase text-[#8b5a08]">
                  media
                </Text>
              </Box>
            ) : null}
            <Box
              className={`rounded-full px-1.5 py-0.5 ${
                treatment === "presenter"
                  ? "bg-[#eef5f0]"
                  : treatment === "b-roll"
                    ? "bg-[#e9eef5]"
                    : "bg-[#f0eee8]"
              }`}
            >
              <Text className="text-[9px] font-bold uppercase text-[#514d46]">
                {treatment}
              </Text>
            </Box>
            {flagged ? (
              <Box className="rounded-full bg-[#fff2cf] px-1.5 py-0.5">
                <Text className="text-[9px] font-bold uppercase text-[#8b5a08]">
                  flagged
                </Text>
              </Box>
            ) : null}
          </Box>
          <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
            Starts at {sentenceLabel(card.enterAt.narration)} · "{card.enterAt.word}"
          </Text>
          <Text className="text-[11px] text-muted-foreground" numberOfLines={2}>
            {provenanceLabel(card.provenance)}
          </Text>
          {avatarMode && !isBroll ? (
            <Box className="mt-1 flex-row self-start rounded-full border border-[#d8d4ca] bg-[#f8f6f0] p-0.5">
              <Pressable
                onPress={() => {
                  if (!overlayEligible || savingTreatment) return;
                  setSavingTreatment(true);
                  void setVisualTreatment({
                    runId,
                    unitId,
                    cardIndex: index,
                    visualTreatment: "avatar-overlay",
                  })
                    .catch((error) =>
                      onError(
                        getUserFacingErrorMessage(
                          error,
                          "Could not change this card treatment."
                        )
                      )
                    )
                    .finally(() => setSavingTreatment(false));
                }}
                className={`rounded-full px-2 py-1 ${
                  treatment === "presenter" ? "bg-[#1f1d1a]" : ""
                } ${!overlayEligible ? "opacity-40" : ""}`}
              >
                <Text
                  className={`text-[9px] font-bold ${
                    treatment === "presenter" ? "text-white" : "text-[#69645c]"
                  }`}
                >
                  Presenter
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (titleLocked || savingTreatment) return;
                  setSavingTreatment(true);
                  void setVisualTreatment({
                    runId,
                    unitId,
                    cardIndex: index,
                    visualTreatment: "standard",
                  })
                    .catch((error) =>
                      onError(
                        getUserFacingErrorMessage(
                          error,
                          "Could not change this card treatment."
                        )
                      )
                    )
                    .finally(() => setSavingTreatment(false));
                }}
                className={`rounded-full px-2 py-1 ${
                  treatment === "content" ? "bg-[#1f1d1a]" : ""
                } ${titleLocked ? "opacity-40" : ""}`}
              >
                <Text
                  className={`text-[9px] font-bold ${
                    treatment === "content" ? "text-white" : "text-[#69645c]"
                  }`}
                >
                  Content
                </Text>
              </Pressable>
            </Box>
          ) : null}
          {editable ? (
            <Box className="mt-1 flex-row">
              <Button size="sm" variant="outline" className="h-7 rounded-full px-2" onPress={() => setEditingContent((value) => !value)}>
                <ButtonText className="text-[11px]">
                  {editingContent ? "Close fields" : "Edit content"}
                </ButtonText>
              </Button>
            </Box>
          ) : null}
        </Box>
      </Box>
      {editingContent ? (
        <CardContentEditor
          runId={runId}
          unitId={unitId}
          cardIndex={index}
          card={card}
          onSaved={() => setEditingContent(false)}
          onCancel={() => setEditingContent(false)}
          editable={editable}
          onError={onError}
        />
      ) : null}
      {MEDIA_TEMPLATES.includes(card.template) && editable ? (
        <SwapAssetControl
          runId={runId}
          unitId={unitId}
          cardIndex={index}
          template={card.template}
          currentRef={typeof card.props.assetRef === "string" ? card.props.assetRef : null}
          onError={onError}
        />
      ) : null}
    </Box>
  );
}

function CardContentEditor({
  runId,
  unitId,
  cardIndex,
  card,
  onSaved,
  onCancel,
  editable,
  onError,
}: {
  runId: Id<"runs">;
  unitId: Id<"microUnits">;
  cardIndex: number;
  card: UnitCard;
  onSaved: () => void;
  onCancel: () => void;
  editable: boolean;
  onError: (message: string | null) => void;
}) {
  const updateCardProps = useMutation(api.pipeline.tts.edit.adminUpdateCardProps);
  const [draftProps, setDraftProps] = useState<Record<string, unknown>>(card.props);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraftProps(card.props);
  }, [card.props]);

  const fields = useMemo(
    () => collectEditableCardTextFields(draftProps),
    [draftProps]
  );
  const dirty = JSON.stringify(draftProps) !== JSON.stringify(card.props);

  function updateField(path: CardPropPath, value: string) {
    setDraftProps((current) =>
      setCardPropAtPath(current, path, value) as Record<string, unknown>
    );
  }

  async function save() {
    if (!editable) return;
    onError(null);
    setBusy(true);
    try {
      await updateCardProps({ runId, unitId, cardIndex, props: draftProps });
      onSaved();
    } catch (err) {
      onError(getUserFacingErrorMessage(err, "Could not save card content."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box className="gap-2 rounded-lg border border-[#dedbd2] bg-[#fbfaf6] p-2">
      {fields.length === 0 ? (
        <Text className="text-xs text-muted-foreground">
          This card has no editable text fields. Use the asset picker for media.
        </Text>
      ) : (
        fields.map((field) => (
          <Box key={field.path.join(".")} className="gap-1">
            <Text className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {field.label}
            </Text>
            {field.multiline ? (
              <Textarea className="bg-white">
                <TextareaInput
                  value={field.value}
                  onChangeText={(text) => updateField(field.path, text)}
                  multiline
                  numberOfLines={3}
                />
              </Textarea>
            ) : (
              <Input className="bg-white">
                <InputField
                  value={field.value}
                  onChangeText={(text) => updateField(field.path, text)}
                />
              </Input>
            )}
          </Box>
        ))
      )}
      <Box className="flex-row gap-2">
        <Button
          size="sm"
          onPress={() => void save()}
          disabled={!editable || busy || !dirty || fields.length === 0}
        >
          <ButtonText>{busy ? "Saving" : "Save card"}</ButtonText>
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onPress={onCancel}>
          <ButtonText>Cancel</ButtonText>
        </Button>
      </Box>
    </Box>
  );
}

function AnchorContentEditor({
  runId,
  unitId,
  template,
  props,
  onSaved,
  onCancel,
  editable,
  onError,
}: {
  runId: Id<"runs">;
  unitId: Id<"microUnits">;
  template: string;
  props: Record<string, unknown>;
  onSaved: () => void;
  onCancel: () => void;
  editable: boolean;
  onError: (message: string | null) => void;
}) {
  const updateAnchorProps = useMutation(api.pipeline.tts.edit.adminUpdateAnchorProps);
  const [draftProps, setDraftProps] = useState<Record<string, unknown>>(props);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraftProps(props);
  }, [props]);

  const fields = useMemo(
    () => collectEditableCardTextFields(draftProps),
    [draftProps]
  );
  const dirty = JSON.stringify(draftProps) !== JSON.stringify(props);

  function updateField(path: CardPropPath, value: string) {
    setDraftProps((current) =>
      setCardPropAtPath(current, path, value) as Record<string, unknown>
    );
  }

  async function save() {
    if (!editable) return;
    onError(null);
    setBusy(true);
    try {
      await updateAnchorProps({ runId, unitId, props: draftProps });
      onSaved();
    } catch (err) {
      onError(getUserFacingErrorMessage(err, "Could not save anchor content."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box className="gap-2 rounded-lg border border-[#dedbd2] bg-[#fbfaf6] p-2">
      <Text className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {cardTemplateLabel(template)} fields
      </Text>
      {fields.length === 0 ? (
        <Text className="text-xs text-muted-foreground">
          This anchor has no editable text fields.
        </Text>
      ) : (
        fields.map((field) => (
          <Box key={field.path.join(".")} className="gap-1">
            <Text className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {field.label}
            </Text>
            {field.multiline ? (
              <Textarea className="bg-white">
                <TextareaInput
                  value={field.value}
                  onChangeText={(text) => updateField(field.path, text)}
                  multiline
                  numberOfLines={3}
                />
              </Textarea>
            ) : (
              <Input className="bg-white">
                <InputField
                  value={field.value}
                  onChangeText={(text) => updateField(field.path, text)}
                />
              </Input>
            )}
          </Box>
        ))
      )}
      <Box className="flex-row gap-2">
        <Button
          size="sm"
          onPress={() => void save()}
          disabled={!editable || busy || !dirty || fields.length === 0}
        >
          <ButtonText>{busy ? "Saving" : "Save anchor"}</ButtonText>
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onPress={onCancel}>
          <ButtonText>Cancel</ButtonText>
        </Button>
      </Box>
    </Box>
  );
}

function QuestionCard({
  row,
  label,
  runId,
  editable,
  onError,
}: {
  row: Doc<"questions">;
  label: string;
  runId: Id<"runs">;
  editable: boolean;
  onError: (message: string | null) => void;
}) {
  const body = row.body as QuestionBody;
  const updateQuestion = useMutation(api.pipeline.courses.adminUpdateQuestion);
  const regenerate = useMutation(api.pipeline.courses.adminRegenerateQuestion);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(body.prompt);
  const [options, setOptions] = useState<string[]>(body.options);
  const [correctIndex, setCorrectIndex] = useState(body.correctIndex);
  const [explanation, setExplanation] = useState(body.explanation);

  useEffect(() => {
    if (!editable) setEditing(false);
  }, [editable]);

  const startEditing = () => {
    if (!editable) return;
    setPrompt(body.prompt);
    setOptions(body.options);
    setCorrectIndex(body.correctIndex);
    setExplanation(body.explanation);
    setEditing(true);
  };

  const onSave = async () => {
    if (!editable) return;
    onError(null);
    setBusy(true);
    try {
      await updateQuestion({
        runId,
        questionId: row._id,
        prompt,
        options,
        correctIndex,
        explanation,
      });
      setEditing(false);
    } catch (err) {
      onError(
        getUserFacingErrorMessage(
          err,
          "Could not save the question. Check every field is filled in."
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const onRegenerate = async () => {
    if (!editable) return;
    onError(null);
    setBusy(true);
    try {
      await regenerate({ runId, questionId: row._id });
    } catch (err) {
      onError(getUserFacingErrorMessage(err, "Regeneration failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <Box className="bg-card border border-border rounded-xl p-3 gap-1">
        <Box className="flex-row items-start gap-2">
          <Box className="flex-1 gap-0.5">
            <Text className="text-sm font-semibold">{body.prompt}</Text>
            {body.options.map((option, index) => (
              <Text
                key={`${row._id}-opt-${index}`}
                className={`text-sm ${
                  index === body.correctIndex
                    ? "text-primary font-semibold"
                    : "text-muted-foreground"
                }`}
              >
                {index === body.correctIndex ? "✓" : "○"} {option}
              </Text>
            ))}
            <Text className="text-xs text-muted-foreground">
              {body.explanation}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {label}
            </Text>
          </Box>
          {editable ? (
            <Box className="gap-1">
              <Button size="sm" variant="outline" onPress={startEditing} disabled={busy}>
                <ButtonText>Edit</ButtonText>
              </Button>
              <Button size="sm" variant="outline" onPress={onRegenerate} disabled={busy}>
                <ButtonText>{busy ? "…" : "Regenerate"}</ButtonText>
              </Button>
            </Box>
          ) : null}
        </Box>
      </Box>
    );
  }

  return (
    <Box className="bg-card border border-primary rounded-xl p-3 gap-2">
      <Input>
        <InputField
          placeholder="Prompt"
          value={prompt}
          onChangeText={setPrompt}
        />
      </Input>
      {options.map((option, index) => (
        <Box key={`${row._id}-edit-${index}`} className="flex-row gap-2 items-center">
          <Pressable
            onPress={() => setCorrectIndex(index)}
            className={`w-6 h-6 rounded-full border items-center justify-center ${
              index === correctIndex
                ? "bg-primary border-primary"
                : "border-border"
            }`}
          >
            {index === correctIndex ? (
              <Text className="text-xs text-white">✓</Text>
            ) : null}
          </Pressable>
          <Box className="flex-1">
            <Input>
              <InputField
                placeholder={`Option ${index + 1}`}
                value={option}
                onChangeText={(text) =>
                  setOptions((current) =>
                    current.map((entry, i) => (i === index ? text : entry))
                  )
                }
              />
            </Input>
          </Box>
        </Box>
      ))}
      <Input>
        <InputField
          placeholder="Explanation"
          value={explanation}
          onChangeText={setExplanation}
        />
      </Input>
      <Box className="flex-row gap-2">
        <Button size="sm" onPress={onSave} disabled={!editable || busy}>
          <ButtonText>Save</ButtonText>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={() => setEditing(false)}
          disabled={busy}
        >
          <ButtonText>Cancel</ButtonText>
        </Button>
      </Box>
    </Box>
  );
}

// --- M6: gate-2 asset swap (re-validates, never re-synthesises) ---

const MEDIA_TEMPLATES = ["video-card", "photo-kenburns", "image-text-card"];

function SwapAssetControl({
  runId,
  unitId,
  cardIndex,
  template,
  currentRef,
  onError,
}: {
  runId: Id<"runs">;
  unitId: Id<"microUnits">;
  cardIndex: number;
  template: string;
  currentRef: string | null;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const swappable = useQuery(
    api.pipeline.assetsCatalogue.adminListSwappableAssets,
    open ? { runId, template } : "skip"
  );
  const swapAsset = useMutation(api.pipeline.tts.edit.adminSwapCardAsset);
  const presignBatch = useAction(api.pipeline.objectStore.adminPresignGetBatch);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!swappable || swappable.length === 0) return;
    const keys = swappable
      .map((asset) => asset.thumbKey)
      .filter((key): key is string => key !== undefined);
    if (keys.length === 0) return;
    let cancelled = false;
    presignBatch({ keys })
      .then((entries) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const entry of entries) map[entry.key] = entry.url;
        setThumbUrls(map);
      })
      .catch(() => {
        // Captions still make the picker usable without thumbnails.
      });
    return () => {
      cancelled = true;
    };
  }, [swappable, presignBatch]);

  async function swapTo(assetId: Id<"assets">) {
    setBusy(true);
    onError(null);
    try {
      await swapAsset({ runId, unitId, cardIndex, assetId });
      setOpen(false);
    } catch (error) {
      onError(
        getUserFacingErrorMessage(error, "Could not swap the asset. Try again.")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box className="gap-1">
      <Button variant="outline" size="sm" onPress={() => setOpen((v) => !v)}>
        <ButtonText>{open ? "Close picker" : "Swap asset"}</ButtonText>
      </Button>
      {open ? (
        <Box className="bg-card border border-border rounded-lg p-2 gap-2">
          {swappable === undefined ? (
            <Text className="text-xs text-muted-foreground">Loading…</Text>
          ) : swappable.length === 0 ? (
            <Text className="text-xs text-muted-foreground">
              No cleared assets fit this template. Declare rights in the asset
              library first.
            </Text>
          ) : (
            swappable.map((asset) => (
              <Pressable
                key={asset._id}
                disabled={busy || asset._id === currentRef}
                onPress={() => void swapTo(asset._id)}
                className={
                  asset._id === currentRef
                    ? "flex-row gap-2 items-center opacity-50"
                    : "flex-row gap-2 items-center"
                }
              >
                {asset.thumbKey && thumbUrls[asset.thumbKey] ? (
                  <Image
                    source={{ uri: thumbUrls[asset.thumbKey] }}
                    resizeMode="cover"
                    style={{ width: 56, height: 36, borderRadius: 4, backgroundColor: "#f4f4f5" }}
                  />
                ) : (
                  <Box className="w-14 h-9 bg-background border border-border rounded" />
                )}
                <Box className="flex-1">
                  <Text className="text-xs" numberOfLines={2}>
                    {asset.caption ?? "(untagged)"}
                  </Text>
                  <Text className="text-[10px] text-muted-foreground">
                    {asset.kind}
                    {asset.durationMs
                      ? ` · ${Math.round(asset.durationMs / 1000)}s`
                      : ""}
                    {asset._id === currentRef ? " · current" : ""}
                  </Text>
                </Box>
              </Pressable>
            ))
          )}
        </Box>
      ) : null}
    </Box>
  );
}
