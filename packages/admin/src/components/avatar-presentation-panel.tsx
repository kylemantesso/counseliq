"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Image } from "react-native";
import {
  Box,
  Pressable,
  ScrollView,
  Text,
} from "@counseliq/ui";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

type Evaluation = {
  description: string;
  setting: string;
  attire: string;
  framing: string;
  tone: string;
  suitableTopics: string[];
  visualTags: string[];
};

type Look = {
  groupId: string;
  lookId: string;
  name: string;
  previewImageUrl?: string | null;
  preferredOrientation?: "portrait" | "landscape" | "square" | null;
  supportedEngines: string[];
  avatarType?: "photo_avatar" | "digital_twin" | "studio_avatar";
  evaluation?: Evaluation;
};

type Assignment = {
  look: Look;
  source: "ai" | "manual" | "fallback";
  reason: string;
  assignedAt: number;
  manuallyLocked?: boolean;
};

type Presentation = {
  mode: "avatar";
  avatarGroupId: string;
  defaultLook: Look;
  unitLooks?: Record<string, Look>;
  unitAssignments?: Record<string, Assignment>;
};

function avatarPresentation(value: unknown): Presentation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Presentation>;
  return candidate.mode === "avatar" && candidate.defaultLook
    ? (candidate as Presentation)
    : null;
}

function knownAvatarType(value: string): Look["avatarType"] {
  return value === "photo_avatar" ||
    value === "digital_twin" ||
    value === "studio_avatar"
    ? value
    : undefined;
}

export function AvatarPresentationPanel({
  runId,
  presentation: rawPresentation,
  unit,
  editable,
  onError,
}: {
  runId: Id<"runs">;
  presentation: unknown;
  unit: { unitKey: string; concept: string };
  editable: boolean;
  onError: (message: string | null) => void;
}) {
  const presentation = useMemo(
    () => avatarPresentation(rawPresentation),
    [rawPresentation]
  );
  const catalog = useQuery(api.pipeline.avatar.catalogueData.adminListAvatarCatalog);
  const setUnitLook = useMutation(api.pipeline.avatar.jobs.adminSetUnitLook);
  const [savingLookId, setSavingLookId] = useState<string | null>(null);

  if (!presentation) return null;

  const catalogLooks = (catalog?.looks ?? [])
    .filter((look) => look.groupId === presentation.avatarGroupId)
    .map((look) => ({
      groupId: look.groupId,
      lookId: look.lookId,
      name: look.name,
      previewImageUrl: look.previewImageUrl ?? null,
      preferredOrientation: look.preferredOrientation ?? null,
      supportedEngines: look.supportedEngines,
      avatarType: knownAvatarType(look.avatarType),
      evaluation: look.evaluation as Evaluation | undefined,
    }));
  const assignment = presentation.unitAssignments?.[unit.unitKey];
  const persistedLook =
    assignment?.look ?? presentation.unitLooks?.[unit.unitKey] ?? presentation.defaultLook;
  const selectedLook =
    catalogLooks.find((look) => look.lookId === persistedLook.lookId) ?? persistedLook;
  const selectedEvaluation = catalogLooks.find(
    (look) => look.lookId === selectedLook.lookId
  )?.evaluation;

  const assign = async (look: Look) => {
    if (!editable || savingLookId) return;
    onError(null);
    setSavingLookId(look.lookId);
    try {
      await setUnitLook({
        runId,
        unitId: unit.unitKey,
        look: {
          groupId: look.groupId,
          lookId: look.lookId,
          name: look.name,
          previewImageUrl: look.previewImageUrl ?? null,
          preferredOrientation: look.preferredOrientation ?? null,
          supportedEngines: look.supportedEngines,
          avatarType: look.avatarType,
        },
      });
    } catch (error) {
      onError(
        getUserFacingErrorMessage(error, "Could not update this video's avatar look.")
      );
    } finally {
      setSavingLookId(null);
    }
  };

  return (
    <Box className="flex-row items-center gap-3 overflow-hidden rounded-2xl border border-[#dedbd2] bg-white px-3 py-2.5">
      <Box className="w-[92px] shrink-0 gap-0.5">
        <Text className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#b11b15]">
          Avatar look
        </Text>
        <Text className="text-[9px] text-muted-foreground">
          {catalogLooks.length} look{catalogLooks.length === 1 ? "" : "s"}
        </Text>
      </Box>

      <ScrollView
        horizontal
        className="min-w-0 flex-1"
        showsHorizontalScrollIndicator
      >
        <Box className="flex-row gap-2.5 pb-1">
          {catalogLooks.map((look) => {
            const selected = look.lookId === selectedLook.lookId;
            return (
              <Pressable
                key={look.lookId}
                onPress={() => void assign(look)}
                disabled={!editable || savingLookId !== null}
                className={`relative h-[78px] w-[60px] shrink-0 overflow-hidden rounded-xl bg-[#f0eee8] ${
                  selected ? "opacity-100" : "opacity-75 hover:opacity-100"
                } ${!editable ? "opacity-60" : ""}`}
              >
                {look.previewImageUrl ? (
                  <Image
                    source={{ uri: look.previewImageUrl }}
                    resizeMode="cover"
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : null}
                {selected ? (
                  <Box className="absolute right-1 top-1 h-4 w-4 items-center justify-center rounded-full bg-[#1f1d1a] shadow-sm">
                    <Text className="text-[8px] font-bold text-white">✓</Text>
                  </Box>
                ) : null}
              </Pressable>
            );
          })}
        </Box>
      </ScrollView>

      <Box className="w-[150px] shrink-0 gap-0.5 border-l border-[#ebe8df] pl-3">
        <Text className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Selected
        </Text>
        <Text className="text-[12px] font-bold text-[#1f1d1a]" numberOfLines={1}>
          {savingLookId ? "Saving..." : selectedLook.name}
        </Text>
        {selectedEvaluation?.setting ? (
          <Text className="text-[10px] text-[#69645c]" numberOfLines={1}>
            {selectedEvaluation.setting}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
