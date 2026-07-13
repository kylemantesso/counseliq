"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  Pressable,
  ScrollView,
  Text,
} from "@counseliq/ui";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

export interface VoiceSettings {
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

export interface CourseTtsVoice {
  provider: string;
  voiceRef: string;
  voiceId: string;
  name?: string;
  accent?: EnglishAccentFilter;
  settings?: VoiceSettings;
}

export type EnglishAccentFilter = "all" | "australian" | "american" | "english";

const ENGLISH_ACCENTS: Array<{ value: EnglishAccentFilter; label: string }> = [
  { value: "all", label: "All English" },
  { value: "australian", label: "Australian" },
  { value: "american", label: "American" },
  { value: "english", label: "English" },
];

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

function Pill({ label, tone }: { label: string; tone: "neutral" | "warning" }) {
  const cls =
    tone === "warning"
      ? "border-[#77611f] bg-[#d6ad2f]/15 text-[#d6ad2f]"
      : "border-[#dedbd2] bg-white text-[#514d46]";
  return (
    <Box className={`rounded-full border px-2.5 py-1 ${cls}`}>
      <Text className="text-[10px] font-bold uppercase tracking-[0.08em]">{label}</Text>
    </Box>
  );
}

export function VoiceStudioModal({
  isOpen,
  runId,
  auditionText,
  currentVoice,
  onClose,
  onError,
  onSaved,
}: {
  isOpen: boolean;
  runId: Id<"runs">;
  auditionText: string;
  currentVoice: CourseTtsVoice | null;
  onClose: () => void;
  onError: (message: string | null) => void;
  onSaved?: () => void;
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
    if (selectedVoiceId && filteredVoices.some((voice) => voice.voiceId === selectedVoiceId)) return;
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
      onSaved?.();
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
              <Pill tone="neutral" label="Course text" />
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
