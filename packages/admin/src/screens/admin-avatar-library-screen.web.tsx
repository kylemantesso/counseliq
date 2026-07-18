"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Box, Button, ButtonText, Heading, Text } from "@counseliq/ui";
import { AdminGuard } from "../components/admin-guard";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
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
  _id: string;
  groupId: string;
  lookId: string;
  name: string;
  previewImageUrl?: string | null;
  tags: string[];
  preferredOrientation?: string | null;
  evaluation?: Evaluation;
  evaluatedAt?: number;
  manuallyEdited?: boolean;
  aiEvaluation?: Evaluation;
};

type AvatarGroup = {
  _id: string;
  groupId: string;
  name: string;
  previewImageUrl?: string | null;
  looksCount: number;
  syncedAt: number;
};

export function AdminAvatarLibraryScreen() {
  return (
    <AdminGuard>
      <AvatarLibraryContent />
    </AdminGuard>
  );
}

function AvatarLibraryContent() {
  const catalog = useQuery(api.pipeline.avatar.catalogueData.adminListAvatarCatalog);
  const syncCatalog = useAction(api.pipeline.avatar.catalogue.adminSyncAvatarCatalog);
  const evaluateLook = useAction(api.pipeline.avatar.catalogue.adminEvaluateAvatarLook);
  const updateEvaluation = useMutation(
    api.pipeline.avatar.catalogueData.adminUpdateAvatarLookEvaluation
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedLookId, setSelectedLookId] = useState<string | null>(null);
  const [editingEvaluation, setEditingEvaluation] = useState(false);
  const [evaluationDraft, setEvaluationDraft] = useState<Evaluation | null>(null);

  const sync = async () => {
    setBusy("sync");
    setError(null);
    try {
      await syncCatalog({});
    } catch (syncError) {
      setError(getUserFacingErrorMessage(syncError, "Could not sync HeyGen avatars."));
    } finally {
      setBusy(null);
    }
  };

  const evaluate = async (lookId: string) => {
    setBusy(lookId);
    setError(null);
    try {
      await evaluateLook({ lookId });
    } catch (evaluateError) {
      setError(getUserFacingErrorMessage(evaluateError, "Could not evaluate this avatar look."));
    } finally {
      setBusy(null);
    }
  };

  const groups = (catalog?.groups ?? []) as AvatarGroup[];
  const looks = (catalog?.looks ?? []) as Look[];
  const selectedGroup = groups.find((group) => group.groupId === selectedGroupId) ?? groups[0] ?? null;
  const groupLooks = useMemo(
    () => looks.filter((look) => look.groupId === selectedGroup?.groupId),
    [looks, selectedGroup?.groupId]
  );
  const selectedLook = groupLooks.find((look) => look.lookId === selectedLookId) ?? groupLooks[0] ?? null;

  useEffect(() => {
    if (!selectedGroupId && groups[0]) setSelectedGroupId(groups[0].groupId);
    if (selectedGroupId && !groups.some((group) => group.groupId === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.groupId ?? null);
    }
  }, [groups, selectedGroupId]);

  useEffect(() => {
    if (selectedLookId && !groupLooks.some((look) => look.lookId === selectedLookId)) {
      setSelectedLookId(groupLooks[0]?.lookId ?? null);
    }
    if (!selectedLookId && groupLooks[0]) setSelectedLookId(groupLooks[0].lookId);
  }, [groupLooks, selectedLookId]);

  useEffect(() => {
    setEditingEvaluation(false);
    setEvaluationDraft(selectedLook?.evaluation ?? null);
  }, [selectedLook?.lookId, selectedLook?.evaluation]);

  const saveEvaluation = async () => {
    if (!selectedLook || !evaluationDraft) return;
    setBusy(`edit:${selectedLook.lookId}`);
    setError(null);
    try {
      await updateEvaluation({
        lookId: selectedLook.lookId,
        evaluation: evaluationDraft,
      });
      setEditingEvaluation(false);
    } catch (updateError) {
      setError(
        getUserFacingErrorMessage(updateError, "Could not save look metadata.")
      );
    } finally {
      setBusy(null);
    }
  };

  const resetEvaluation = async () => {
    if (!selectedLook) return;
    setBusy(`edit:${selectedLook.lookId}`);
    try {
      await updateEvaluation({ lookId: selectedLook.lookId, reset: true });
      setEditingEvaluation(false);
    } catch (updateError) {
      setError(
        getUserFacingErrorMessage(updateError, "Could not reset look metadata.")
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminWorkspaceFrame
      activeNav="avatars"
      title="Avatar library"
      description="Private HeyGen avatars, available looks, and the visual metadata used for per-video assignment."
      topbarTrail={["Avatar library"]}
    >
      <Box className="gap-6">
        <Box className="flex-row flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5">
          <Box className="gap-1">
            <Heading size="lg">HeyGen avatar catalogue</Heading>
            <Text className="text-sm text-muted-foreground">
              Sync discovers new groups and looks. Only new or changed looks are visually evaluated.
            </Text>
          </Box>
          <Button onPress={() => void sync()} isDisabled={busy !== null}>
            <ButtonText>{busy === "sync" ? "Syncing avatars" : "Sync HeyGen"}</ButtonText>
          </Button>
        </Box>
        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
        {catalog === undefined ? <Text className="text-sm text-muted-foreground">Loading avatar library...</Text> : null}
        {groups.length === 0 && catalog !== undefined ? (
          <Box className="rounded-2xl border border-dashed border-border p-8">
            <Text className="text-muted-foreground">No cached private avatars yet. Select Sync HeyGen to load them.</Text>
          </Box>
        ) : null}
        {selectedGroup ? (
          <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[248px_minmax(0,1fr)]">
            <aside className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border bg-card p-3 xl:max-h-[calc(100vh-230px)] xl:overflow-y-auto">
              <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Avatars</p>
              {groups.map((group) => {
                const active = group.groupId === selectedGroup.groupId;
                const count = looks.filter((look) => look.groupId === group.groupId).length;
                return (
                  <button
                    key={group.groupId}
                    type="button"
                    onClick={() => {
                      setSelectedGroupId(group.groupId);
                      setSelectedLookId(null);
                    }}
                    className={`flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${active ? "border-primary bg-primary/10" : "border-transparent bg-muted/30 hover:border-border hover:bg-muted/60"}`}
                  >
                    <div className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                      {group.previewImageUrl ? <img src={group.previewImageUrl} alt="" className="h-full w-full object-contain" /> : null}
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{group.name}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{count} look{count === 1 ? "" : "s"}</span>
                    </span>
                  </button>
                );
              })}
            </aside>

            <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Selected avatar</p>
                  <Heading size="lg">{selectedGroup.name}</Heading>
                  <Text className="mt-1 text-sm text-muted-foreground">
                    {groupLooks.length} available look{groupLooks.length === 1 ? "" : "s"}. Choose a look to inspect its full portrait and cached evaluation.
                  </Text>
                </div>
                <Text className="text-xs text-muted-foreground">Synced {new Date(selectedGroup.syncedAt).toLocaleString()}</Text>
              </div>

              <div className="mt-5 grid grid-flow-col auto-cols-[116px] gap-3 overflow-x-auto pb-2">
                {groupLooks.map((look) => {
                  const active = look.lookId === selectedLook?.lookId;
                  return (
                    <button
                      key={look.lookId}
                      type="button"
                      onClick={() => setSelectedLookId(look.lookId)}
                      className={`overflow-hidden rounded-xl border text-left ${active ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50"}`}
                    >
                      <div className="flex h-32 items-center justify-center bg-muted p-1.5">
                        {look.previewImageUrl ? <img src={look.previewImageUrl} alt="" className="h-full w-full object-contain" /> : null}
                      </div>
                      <span className="block truncate px-2.5 py-2 text-xs font-semibold text-foreground">{look.name}</span>
                    </button>
                  );
                })}
              </div>

              {selectedLook ? (
                <div className="mt-5 grid grid-cols-1 gap-5 border-t border-border pt-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
                  <div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/50 p-4">
                    {selectedLook.previewImageUrl ? (
                      <img src={selectedLook.previewImageUrl} alt={selectedLook.name} className="h-full max-h-[580px] w-full object-contain" />
                    ) : (
                      <Text className="text-sm text-muted-foreground">No HeyGen preview image.</Text>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Look inspector</p>
                      <Heading size="lg">{selectedLook.name}</Heading>
                      <Text className="mt-1 text-sm text-muted-foreground">{selectedLook.preferredOrientation ?? "Orientation not supplied"}</Text>
                      {selectedLook.manuallyEdited ? (
                        <span className="mt-2 inline-flex rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">
                          Manually edited
                        </span>
                      ) : null}
                    </div>
                    {editingEvaluation && evaluationDraft ? (
                      <div className="grid gap-3">
                        <EvaluationField label="Description" value={evaluationDraft.description} onChange={(value) => setEvaluationDraft({ ...evaluationDraft, description: value })} multiline />
                        <EvaluationField label="Setting" value={evaluationDraft.setting} onChange={(value) => setEvaluationDraft({ ...evaluationDraft, setting: value })} />
                        <EvaluationField label="Attire" value={evaluationDraft.attire} onChange={(value) => setEvaluationDraft({ ...evaluationDraft, attire: value })} />
                        <EvaluationField label="Framing" value={evaluationDraft.framing} onChange={(value) => setEvaluationDraft({ ...evaluationDraft, framing: value })} />
                        <EvaluationField label="Tone" value={evaluationDraft.tone} onChange={(value) => setEvaluationDraft({ ...evaluationDraft, tone: value })} />
                        <EvaluationField label="Suitable topics (comma separated)" value={evaluationDraft.suitableTopics.join(", ")} onChange={(value) => setEvaluationDraft({ ...evaluationDraft, suitableTopics: value.split(",").map((item) => item.trim()).filter(Boolean) })} />
                        <EvaluationField label="Visual tags (comma separated)" value={evaluationDraft.visualTags.join(", ")} onChange={(value) => setEvaluationDraft({ ...evaluationDraft, visualTags: value.split(",").map((item) => item.trim()).filter(Boolean) })} />
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onPress={() => void saveEvaluation()} isDisabled={busy !== null}>
                            <ButtonText>{busy === `edit:${selectedLook.lookId}` ? "Saving" : "Save metadata"}</ButtonText>
                          </Button>
                          <Button size="sm" variant="outline" onPress={() => setEditingEvaluation(false)} isDisabled={busy !== null}>
                            <ButtonText>Cancel</ButtonText>
                          </Button>
                          {selectedLook.manuallyEdited ? (
                            <Button size="sm" variant="outline" onPress={() => void resetEvaluation()} isDisabled={busy !== null}>
                              <ButtonText>Reset to AI</ButtonText>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : selectedLook.evaluation ? (
                      <div className="grid gap-3 text-sm leading-6 text-muted-foreground">
                        <p className="text-foreground">{selectedLook.evaluation.description}</p>
                        <Metadata label="Setting" value={selectedLook.evaluation.setting} />
                        <Metadata label="Attire" value={selectedLook.evaluation.attire} />
                        <Metadata label="Framing" value={selectedLook.evaluation.framing} />
                        <Metadata label="Tone" value={selectedLook.evaluation.tone} />
                        <Metadata label="Suitable for" value={selectedLook.evaluation.suitableTopics.join(", ")} />
                        <Metadata label="Visual tags" value={selectedLook.evaluation.visualTags.join(", ")} />
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border p-4">
                        <Text className="text-sm text-muted-foreground">This look has not been visually evaluated yet.</Text>
                      </div>
                    )}
                    <Button variant="outline" size="sm" onPress={() => void evaluate(selectedLook.lookId)} isDisabled={busy !== null}>
                      <ButtonText>{busy === selectedLook.lookId ? "Evaluating look" : selectedLook.evaluation ? "Re-evaluate look" : "Evaluate look"}</ButtonText>
                    </Button>
                    {selectedLook.evaluation && !editingEvaluation ? (
                      <Button variant="outline" size="sm" onPress={() => setEditingEvaluation(true)} isDisabled={busy !== null}>
                        <ButtonText>Edit metadata</ButtonText>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </Box>
    </AdminWorkspaceFrame>
  );
}

function EvaluationField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-foreground">
      {label}
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className="resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal leading-5 text-foreground outline-none focus:border-primary"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-primary"
        />
      )}
    </label>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <strong className="font-semibold text-foreground">{label}: </strong>
      {value}
    </p>
  );
}
