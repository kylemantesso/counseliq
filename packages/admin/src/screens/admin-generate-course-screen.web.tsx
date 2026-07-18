"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "solito/navigation";
import {
  Alert,
  AlertText,
  Box,
  Button,
  ButtonText,
  EmptyStateCard,
  StatusBadge,
  StepIndicator,
  SurfaceCard,
  Text,
  Textarea,
  TextareaInput,
} from "@counseliq/ui";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { useSelectedInstitution } from "../components/admin/use-selected-institution";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

const DOC_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const WIZARD_STEPS = ["Source material", "Media & rights", "Review & generate"] as const;
const MEDIA_PAGE_SIZE = 6;
const TITLE_FALLBACK = "Untitled source document";

type SourceDocFactReview = {
  sourceDocId: Id<"sourceDocs">;
  status: string;
  extractionComplete: boolean;
  facts: {
    pendingCandidates: number;
  };
};

type CourseAsset = Doc<"assets"> & { cleared: boolean };
type MediaFilter = "all" | "included" | "needs-rights";
type AvatarGroup = {
  id: string;
  name: string;
  previewImageUrl: string | null;
  looksCount: number;
  status: string | null;
  consentStatus: string | null;
};
type AvatarLook = {
  groupId: string;
  lookId: string;
  name: string;
  previewImageUrl: string | null;
  preferredOrientation: "portrait" | "landscape" | "square" | null;
  supportedEngines: string[];
  tags: string[];
  avatarType: string;
  status: string | null;
};

export function AdminGenerateCourseScreen() {
  return (
    <AdminGuard>
      <GenerateCourseContent />
    </AdminGuard>
  );
}

async function contentKeyForFile(file: File): Promise<{ key: string; ext: string; bytes: ArrayBuffer }> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  return { key: `sha256/${hex}.${ext}`, ext, bytes };
}

function GenerateCourseContent() {
  const { selectedInstitution, selectedInstitutionId } = useSelectedInstitution();

  return (
    <AdminWorkspaceFrame
      activeNav="create-run"
      title="Create a course"
      description={
        selectedInstitution
          ? `${selectedInstitution.name} · gather your source material, then generate.`
          : "Choose a workspace institution to create a course."
      }
      topbarTrail={["Create course"]}
    >
      {!selectedInstitution || !selectedInstitutionId ? (
        <EmptyStateCard
          title="No institution selected"
          description="Pick an institution from the workspace selector before generating a course."
        />
      ) : (
        <GenerateForInstitution
          key={selectedInstitutionId}
          institutionId={selectedInstitutionId}
          institutionName={selectedInstitution.name}
        />
      )}
    </AdminWorkspaceFrame>
  );
}

function GenerateForInstitution({
  institutionId,
  institutionName,
}: {
  institutionId: Id<"institutions">;
  institutionName: string;
}) {
  const router = useRouter();
  const allDocs = useQuery(api.pipeline.queries.listSourceDocs, {});
  const factReviews = useQuery(api.pipeline.queries.listSourceDocFactReviews, {
    institutionId,
  });
  const assets = useQuery(api.pipeline.assetsCatalogue.adminListAssets, { institutionId });
  const presignPutBatch = useAction(api.pipeline.objectStore.adminPresignPutBatch);
  const presignGetBatch = useAction(api.pipeline.objectStore.adminPresignGetBatch);
  const registerDoc = useMutation(api.pipeline.ingestion.adminRegisterSourceDoc);
  const cloneConvertedDoc = useMutation(api.pipeline.ingestion.adminCloneConvertedSourceDoc);
  const requestConversions = useMutation(
    api.pipeline.ingestion.adminRequestSourceDocConversions
  );
  const startRun = useMutation(api.pipeline.runs.adminStartRun);
  const listAvatarGroups = useAction(api.pipeline.avatar.heygen.adminListAvatarGroups);
  const listAvatarLooks = useAction(api.pipeline.avatar.heygen.adminListAvatarLooks);

  const [stepIndex, setStepIndex] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<Set<string> | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string> | null>(null);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [clearedOnly, setClearedOnly] = useState(false);
  const [visibleAssetCount, setVisibleAssetCount] = useState(MEDIA_PAGE_SIZE);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [brief, setBrief] = useState("");
  const [presentationMode, setPresentationMode] = useState<"standard" | "avatar">("standard");
  const [avatarGroups, setAvatarGroups] = useState<AvatarGroup[]>([]);
  const [avatarLooks, setAvatarLooks] = useState<AvatarLook[]>([]);
  const [selectedAvatarGroupId, setSelectedAvatarGroupId] = useState<string | null>(null);
  const [selectedAvatarLookId, setSelectedAvatarLookId] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarGroupsRequested = useRef(false);
  const avatarLooksRequestedForGroup = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleBriefChange(
    valueOrEvent: string | { target?: { value?: string }; nativeEvent?: { text?: string } }
  ) {
    if (typeof valueOrEvent === "string") {
      setBrief(valueOrEvent);
      return;
    }

    const nextValue = valueOrEvent.target?.value ?? valueOrEvent.nativeEvent?.text;
    if (typeof nextValue === "string") setBrief(nextValue);
  }

  const docs = useMemo(() => {
    const byKey = new Map<string, Doc<"sourceDocs">>();
    for (const doc of allDocs ?? []) {
      if (doc.institutionId !== institutionId) continue;
      if (!byKey.has(doc.objectKey)) byKey.set(doc.objectKey, doc);
    }
    return [...byKey.values()];
  }, [allDocs, institutionId]);

  const factReviewByDocId = useMemo(() => {
    const map = new Map<string, SourceDocFactReview>();
    for (const review of (factReviews ?? []) as SourceDocFactReview[]) {
      map.set(String(review.sourceDocId), review);
    }
    return map;
  }, [factReviews]);

  const defaultSelectedKeys = useMemo(
    () =>
      new Set(
        docs
          .filter((doc) =>
            isDocReadyForGeneration(doc, factReviewByDocId.get(String(doc._id)))
          )
          .map((doc) => doc.objectKey)
      ),
    [docs, factReviewByDocId]
  );

  const effectiveDocSelection = selectedKeys ?? defaultSelectedKeys;
  const selectedDocs = docs.filter((doc) => effectiveDocSelection.has(doc.objectKey));
  const selectedPageCount = selectedDocs.reduce((total, doc) => total + (doc.pageCount ?? 0), 0);

  const catalogueAssets = (assets ?? []) as CourseAsset[];
  const defaultAssetIds = useMemo(
    () => new Set((assets ?? []).filter((asset) => asset.cleared).map((asset) => String(asset._id))),
    [assets]
  );
  const effectiveAssetSelection = selectedAssetIds ?? defaultAssetIds;
  const selectedAssets = catalogueAssets.filter((asset) => effectiveAssetSelection.has(asset._id));
  const selectedClearedCount = selectedAssets.filter((asset) => asset.cleared).length;
  const selectedNeedsRightsCount = selectedAssets.length - selectedClearedCount;
  const totalNeedsRightsCount = catalogueAssets.filter((asset) => !asset.cleared).length;

  const filteredAssets = useMemo(() => {
    return catalogueAssets.filter((asset) => {
      if (clearedOnly && !asset.cleared) return false;
      if (mediaFilter === "included" && !effectiveAssetSelection.has(asset._id)) return false;
      if (mediaFilter === "needs-rights" && asset.cleared) return false;
      return true;
    });
  }, [catalogueAssets, clearedOnly, effectiveAssetSelection, mediaFilter]);
  const visibleAssets = filteredAssets.slice(0, visibleAssetCount);

  useEffect(() => {
    if (!assets || assets.length === 0) {
      setThumbnailUrls({});
      return;
    }
    const keys = [
      ...new Set(
        assets
          .map((asset) => asset.thumbKey ?? (asset.kind === "image" ? asset.objectKey : null))
          .filter((key): key is string => key !== null)
      ),
    ];
    if (keys.length === 0) {
      setThumbnailUrls({});
      return;
    }

    let cancelled = false;
    const batches: string[][] = [];
    for (let index = 0; index < keys.length; index += 300) {
      batches.push(keys.slice(index, index + 300));
    }
    Promise.all(batches.map((batch) => presignGetBatch({ keys: batch })))
      .then((results) => {
        if (cancelled) return;
        const nextUrls: Record<string, string> = {};
        for (const entry of results.flat()) nextUrls[entry.key] = entry.url;
        setThumbnailUrls(nextUrls);
      })
      .catch(() => {
        if (!cancelled) setThumbnailUrls({});
      });
    return () => {
      cancelled = true;
    };
  }, [assets, presignGetBatch]);

  useEffect(() => {
    if (presentationMode !== "avatar" || avatarGroupsRequested.current) return;
    let cancelled = false;
    avatarGroupsRequested.current = true;
    setAvatarLoading(true);
    setAvatarError(null);
    listAvatarGroups({})
      .then((groups) => {
        if (cancelled) return;
        const loaded = groups as AvatarGroup[];
        setAvatarGroups(loaded);
        setSelectedAvatarGroupId(loaded[0]?.id ?? null);
        if (loaded.length === 0) {
          setAvatarError("No private HeyGen avatars are available for this account.");
        }
      })
      .catch((loadError) => {
        if (!cancelled) setAvatarError(getUserFacingErrorMessage(loadError, "Could not load HeyGen avatars."));
      })
      .finally(() => {
        if (!cancelled) setAvatarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listAvatarGroups, presentationMode]);

  useEffect(() => {
    if (
      presentationMode !== "avatar" ||
      !selectedAvatarGroupId ||
      avatarLooksRequestedForGroup.current === selectedAvatarGroupId
    ) {
      return;
    }
    let cancelled = false;
    avatarLooksRequestedForGroup.current = selectedAvatarGroupId;
    setAvatarLoading(true);
    setAvatarError(null);
    listAvatarLooks({ groupId: selectedAvatarGroupId })
      .then((looks) => {
        if (cancelled) return;
        const loaded = looks as AvatarLook[];
        setAvatarLooks(loaded);
        setSelectedAvatarLookId(loaded[0]?.lookId ?? null);
        if (loaded.length === 0) {
          setAvatarError("This HeyGen avatar has no completed looks available.");
        }
      })
      .catch((loadError) => {
        if (!cancelled) setAvatarError(getUserFacingErrorMessage(loadError, "Could not load this avatar's looks."));
      })
      .finally(() => {
        if (!cancelled) setAvatarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listAvatarLooks, presentationMode, selectedAvatarGroupId]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy("Uploading document(s)…");
    try {
      for (const file of Array.from(files)) {
        const { key, ext, bytes } = await contentKeyForFile(file);
        const contentType = DOC_CONTENT_TYPES[ext];
        if (!contentType) {
          setBusy(null);
          setError(`${file.name}: only .pdf and .pptx are supported.`);
          return;
        }
        const [put] = await presignPutBatch({ items: [{ key, contentType }] });
        const response = await fetch(put.url, {
          method: "PUT",
          headers: { "content-type": contentType },
          body: bytes,
        });
        if (!response.ok) {
          setBusy(null);
          setError(`Could not upload ${file.name}. Try again.`);
          return;
        }
        const sourceDocId = await registerDoc({
          institutionId,
          objectKey: key,
          kind: ext as "pdf" | "pptx",
          originalFilename: file.name,
        });
        await requestConversions({ sourceDocIds: [sourceDocId] });
      }
      setBusy(null);
    } catch (uploadError) {
      setBusy(null);
      setError(
        getUserFacingErrorMessage(
          uploadError,
          "Could not upload and process the source document. Try again."
        )
      );
    }
  }

  async function startRunNow() {
    if (selectedDocs.length === 0) {
      setError("Select at least one source document.");
      return;
    }
    const selectedAvatarLook = avatarLooks.find((look) => look.lookId === selectedAvatarLookId) ?? null;
    if (presentationMode === "avatar" && !selectedAvatarLook) {
      setError("Choose a completed HeyGen avatar look before generating the course.");
      return;
    }
    const notReady = selectedDocs.filter((doc) => doc.status !== "converted");
    if (notReady.length > 0) {
      setError(
        `Wait for conversion to finish on ${notReady.length} document(s) before generating the course.`
      );
      return;
    }
    const docsNeedingFactReview = selectedDocs.filter((doc) => {
      const review = factReviewByDocId.get(String(doc._id));
      return !review || review.status !== "approved";
    });
    if (docsNeedingFactReview.length > 0) {
      setError(
        `Review extracted facts on ${docsNeedingFactReview.length} document(s) before generating the course.`
      );
      return;
    }
    setBusy("Generating course…");
    setError(null);
    try {
      const sourceDocIds: Id<"sourceDocs">[] = [];
      for (const doc of selectedDocs) {
        if (doc.runId === undefined) {
          sourceDocIds.push(doc._id);
          continue;
        }
        sourceDocIds.push(await cloneConvertedDoc({ sourceDocId: doc._id }));
      }
      const runId = await startRun({
        institutionId,
        sourceDocIds,
        assetIds: [...effectiveAssetSelection] as Id<"assets">[],
        ...(brief.trim() ? { brief: brief.trim() } : {}),
        ...(selectedAvatarLook
          ? {
              presentation: {
                mode: "avatar" as const,
                provider: "heygen" as const,
                avatarGroupId: selectedAvatarLook.groupId,
                defaultLook: {
                  groupId: selectedAvatarLook.groupId,
                  lookId: selectedAvatarLook.lookId,
                  name: selectedAvatarLook.name,
                  previewImageUrl: selectedAvatarLook.previewImageUrl,
                  preferredOrientation: selectedAvatarLook.preferredOrientation,
                  supportedEngines: selectedAvatarLook.supportedEngines,
                  avatarType:
                    selectedAvatarLook.avatarType === "photo_avatar" ||
                    selectedAvatarLook.avatarType === "digital_twin" ||
                    selectedAvatarLook.avatarType === "studio_avatar"
                      ? selectedAvatarLook.avatarType
                      : undefined,
                },
                unitLooks: {},
                assignmentStrategy: "ai-per-unit" as const,
                engine: selectedAvatarLook.supportedEngines.includes("avatar_v")
                  ? ("avatar_v" as const)
                  : ("avatar_iv" as const),
              },
            }
          : { presentation: { mode: "standard" as const } }),
      });
      router.push(`/admin/runs/${runId}`);
    } catch (startError) {
      setBusy(null);
      setError(getUserFacingErrorMessage(startError, "Could not generate the course. Try again."));
    }
  }

  function goToStep(nextStep: number) {
    setError(null);
    setStepIndex(Math.max(0, Math.min(WIZARD_STEPS.length - 1, nextStep)));
  }

  function setAssetFilter(filter: MediaFilter) {
    setMediaFilter(filter);
    setVisibleAssetCount(MEDIA_PAGE_SIZE);
  }

  function toggleAsset(assetId: Id<"assets">) {
    setSelectedAssetIds(() => {
      const next = new Set(effectiveAssetSelection);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  const canContinue =
    stepIndex === 0 ? selectedDocs.length > 0 : stepIndex === 1 ? assets !== undefined : false;

  return (
    <Box className="gap-6">
      <StepIndicator steps={WIZARD_STEPS} currentIndex={stepIndex} />

      <Box className="flex-col items-stretch gap-6 lg:flex-row lg:items-start">
        <Box className="min-w-0 flex-1 gap-[18px]">
          {stepIndex === 0 ? (
            <SurfaceCard
              title="Source material"
              subtitle="Choose the converted and reviewed documents this course will be built from."
            >
              {docs.length === 0 ? (
                <Text className="text-sm text-muted-foreground">
                  No source documents yet for this institution.
                </Text>
              ) : (
                <Box className="gap-2.5">
                  {docs.map((doc) => {
                    const review = factReviewByDocId.get(String(doc._id));
                    const selectable = isDocReadyForGeneration(doc, review);
                    return (
                      <label
                        key={doc.objectKey}
                        style={{
                          alignItems: "center",
                          background: selectable ? "var(--color-background)" : "var(--color-muted)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 11,
                          cursor: selectable ? "pointer" : "not-allowed",
                          display: "flex",
                          gap: 14,
                          opacity: selectable ? 1 : 0.7,
                          padding: "14px 16px",
                        }}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Include ${doc.originalFilename ?? doc.objectKey}`}
                          disabled={!selectable}
                          checked={effectiveDocSelection.has(doc.objectKey)}
                          onChange={() => {
                            setSelectedKeys(() => {
                              const next = new Set(effectiveDocSelection);
                              if (next.has(doc.objectKey)) next.delete(doc.objectKey);
                              else next.add(doc.objectKey);
                              return next;
                            });
                          }}
                          style={{ accentColor: "var(--color-primary)", height: 18, width: 18 }}
                        />
                        <Box className="h-9 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
                          <Text className="text-[9px] font-bold uppercase text-muted-foreground">
                            {doc.kind}
                          </Text>
                        </Box>
                        <Box className="min-w-0 flex-1 gap-0.5">
                          <SourceDocTitle doc={doc} factReview={review} />
                        </Box>
                        <StatusBadge
                          label={selectable ? "Ready" : factReviewLabel(review) ?? doc.status}
                          tone={selectable ? "success" : "neutral"}
                        />
                      </label>
                    );
                  })}
                  <Text className="text-xs leading-5 text-muted-foreground">
                    To unlock a document, open it in Source documents and approve its extracted facts.
                  </Text>
                </Box>
              )}

              <Box className="flex-row flex-wrap items-center gap-3 border-t border-border pt-4">
                <label
                  style={{
                    alignItems: "center",
                    border: "1px solid var(--color-input)",
                    borderRadius: 10,
                    cursor: busy ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    fontSize: 13,
                    fontWeight: 600,
                    minHeight: 40,
                    overflow: "hidden",
                    padding: "9px 16px",
                    position: "relative",
                  }}
                >
                  + {busy?.startsWith("Uploading") ? busy : "Upload a PDF or PowerPoint"}
                  <input
                    type="file"
                    multiple
                    disabled={busy !== null}
                    aria-label="Upload PDF or PowerPoint source documents"
                    accept=".pdf,.pptx"
                    style={{ cursor: "pointer", inset: 0, opacity: 0, position: "absolute" }}
                    onChange={(event) => {
                      void handleUpload(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
                <Text className="text-xs text-muted-foreground">
                  Uploaded files are converted and sent to fact review before they become available.
                </Text>
              </Box>
              {error ? (
                <Alert variant="destructive">
                  <AlertText>{error}</AlertText>
                </Alert>
              ) : null}
            </SurfaceCard>
          ) : null}

          {stepIndex === 1 ? (
            <SurfaceCard
              title="Choose the media to include"
              subtitle="Pick media from this institution's library. Items needing a rights check can be included now, but must be cleared before publishing."
            >
              <Box className="flex-row flex-wrap items-center justify-between gap-3">
                <Box className="flex-row flex-wrap items-center gap-2">
                  <FilterButton
                    label={`All · ${catalogueAssets.length}`}
                    active={mediaFilter === "all"}
                    onPress={() => setAssetFilter("all")}
                  />
                  <FilterButton
                    label={`Included · ${selectedAssets.length}`}
                    active={mediaFilter === "included"}
                    onPress={() => setAssetFilter("included")}
                  />
                  <FilterButton
                    label={`Needs rights check · ${totalNeedsRightsCount}`}
                    active={mediaFilter === "needs-rights"}
                    onPress={() => setAssetFilter("needs-rights")}
                  />
                </Box>
                <Box className="flex-row flex-wrap items-center gap-3">
                  <label
                    style={{
                      alignItems: "center",
                      cursor: "pointer",
                      display: "flex",
                      fontSize: 12.5,
                      fontWeight: 600,
                      gap: 7,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={clearedOnly}
                      onChange={(event) => {
                        setClearedOnly(event.target.checked);
                        setVisibleAssetCount(MEDIA_PAGE_SIZE);
                      }}
                      style={{ accentColor: "var(--color-primary)", height: 15, width: 15 }}
                    />
                    Cleared only
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => {
                      setSelectedAssetIds(() => {
                        const next = new Set(effectiveAssetSelection);
                        for (const asset of catalogueAssets) {
                          if (asset.cleared) next.add(asset._id);
                        }
                        return next;
                      });
                    }}
                  >
                    <ButtonText>Include all cleared</ButtonText>
                  </Button>
                </Box>
              </Box>

              {assets === undefined ? (
                <Text className="text-sm text-muted-foreground">Loading media library…</Text>
              ) : filteredAssets.length === 0 ? (
                <Box className="rounded-xl border border-dashed border-border px-5 py-8">
                  <Text className="text-center text-sm text-muted-foreground">
                    No media matches these filters.
                  </Text>
                </Box>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {visibleAssets.map((asset) => {
                      const thumbnailKey = getAssetThumbnailKey(asset);
                      return (
                        <MediaAssetCard
                          key={asset._id}
                          asset={asset}
                          selected={effectiveAssetSelection.has(asset._id)}
                          thumbnailUrl={thumbnailKey ? thumbnailUrls[thumbnailKey] ?? null : null}
                          onToggle={() => toggleAsset(asset._id)}
                        />
                      );
                    })}
                  </div>
                  {visibleAssets.length < filteredAssets.length ? (
                    <Button
                      variant="link"
                      className="self-center"
                      onPress={() => setVisibleAssetCount((count) => count + MEDIA_PAGE_SIZE)}
                    >
                      <ButtonText>
                        Show more · {filteredAssets.length - visibleAssets.length} remaining
                      </ButtonText>
                    </Button>
                  ) : null}
                </>
              )}
            </SurfaceCard>
          ) : null}

          {stepIndex === 2 ? (
            <SurfaceCard
              title="Review & generate"
              subtitle="Check everything below, add any focus notes, then start generating. This can take several minutes."
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ReviewMetric label="Institution" value={institutionName} />
                <ReviewMetric
                  label="Source material"
                  value={`${selectedDocs.length} document${selectedDocs.length === 1 ? "" : "s"}${
                    selectedPageCount > 0 ? ` · ${selectedPageCount} pages` : ""
                  }`}
                />
                <ReviewMetric
                  label="Media included"
                  value={`${selectedAssets.length} item${selectedAssets.length === 1 ? "" : "s"}`}
                />
                <ReviewMetric
                  label="Before publishing"
                  value={
                    selectedNeedsRightsCount > 0
                      ? `${selectedNeedsRightsCount} item${selectedNeedsRightsCount === 1 ? "" : "s"} to clear`
                      : "All selected media cleared"
                  }
                  warning={selectedNeedsRightsCount > 0}
                />
              </div>

              <Box className="gap-2">
                <Text className="text-[13px] font-semibold text-foreground">
                  Focus notes <Text className="font-normal text-muted-foreground">(optional)</Text>
                </Text>
                <Textarea>
                  <TextareaInput
                    value={brief}
                    multiline
                    className="min-h-[92px] py-3"
                    onChangeText={handleBriefChange}
                    onChange={handleBriefChange as never}
                    placeholder='Add guidance on outcomes, target audience, or emphasis — e.g. "Pitch for first-year students; foreground academic integrity and where to get help."'
                  />
                </Textarea>
                <Text className="text-xs text-muted-foreground">
                  Guidance is read-only once generation starts.
                </Text>
              </Box>

              <Box className="gap-3 border-t border-border pt-5">
                <Box className="gap-1">
                  <Text className="text-[13px] font-semibold text-foreground">Presentation</Text>
                  <Text className="text-xs leading-5 text-muted-foreground">
                    Use standard cards only, or generate a HeyGen presenter track with avatar-overlay cards.
                  </Text>
                </Box>
                <Box className="flex-row flex-wrap gap-2">
                  <Button
                    variant={presentationMode === "standard" ? "default" : "outline"}
                    size="sm"
                    onPress={() => setPresentationMode("standard")}
                  >
                    <ButtonText>Standard cards</ButtonText>
                  </Button>
                  <Button
                    variant={presentationMode === "avatar" ? "default" : "outline"}
                    size="sm"
                    onPress={() => setPresentationMode("avatar")}
                  >
                    <ButtonText>HeyGen avatar</ButtonText>
                  </Button>
                </Box>
                {presentationMode === "avatar" ? (
                  <Box className="gap-3 rounded-xl border border-border bg-muted/30 p-3">
                    {avatarLoading && avatarGroups.length === 0 ? (
                      <Text className="text-sm text-muted-foreground">Loading private HeyGen avatars...</Text>
                    ) : null}
                    {avatarError ? <Text className="text-sm text-destructive">{avatarError}</Text> : null}
                    {avatarGroups.length > 0 ? (
                      <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                        Avatar
                        <select
                          value={selectedAvatarGroupId ?? ""}
                          onChange={(event) => setSelectedAvatarGroupId(event.target.value || null)}
                          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        >
                          {avatarGroups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.name} · {group.looksCount} look{group.looksCount === 1 ? "" : "s"}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {avatarLooks.length > 0 ? (
                      <Box className="flex-row flex-wrap gap-2">
                        {avatarLooks.map((look) => {
                          const selected = look.lookId === selectedAvatarLookId;
                          return (
                            <button
                              key={look.lookId}
                              type="button"
                              onClick={() => setSelectedAvatarLookId(look.lookId)}
                              className={`flex w-[142px] flex-col overflow-hidden rounded-lg border text-left ${selected ? "border-primary bg-primary/10" : "border-border bg-background"}`}
                            >
                              {look.previewImageUrl ? <img src={look.previewImageUrl} alt="" className="h-24 w-full object-cover" /> : null}
                              <span className="p-2 text-xs font-semibold text-foreground">{look.name}</span>
                            </button>
                          );
                        })}
                      </Box>
                    ) : null}
                    <Text className="text-xs leading-5 text-muted-foreground">
                      These are all available looks for the selected avatar. CounselIQ will evaluate and assign the best look to each video after the course is compiled. You can override any video during course review.
                    </Text>
                  </Box>
                ) : null}
              </Box>

              {selectedNeedsRightsCount > 0 ? (
                <Alert className="border-accent bg-accent">
                  <AlertText className="text-accent-foreground">
                    You can generate now. {selectedNeedsRightsCount} selected media item
                    {selectedNeedsRightsCount === 1 ? "" : "s"} still need a rights check. They
                    must be cleared before the course can be published.
                  </AlertText>
                </Alert>
              ) : (
                <Alert>
                  <AlertText>All selected media is cleared for publishing.</AlertText>
                </Alert>
              )}

              {error ? (
                <Alert variant="destructive">
                  <AlertText>{error}</AlertText>
                </Alert>
              ) : null}

              <Box className="gap-2 border-t border-border pt-5">
                <Button
                  size="lg"
                  onPress={() => void startRunNow()}
                  isDisabled={busy !== null || selectedDocs.length === 0 || assets === undefined}
                >
                  <ButtonText>{busy ?? "Generate course"}</ButtonText>
                </Button>
                <Text className="text-center text-xs text-muted-foreground">
                  You'll be taken to the live progress view.
                </Text>
              </Box>
            </SurfaceCard>
          ) : null}

          <Box className="flex-row items-center justify-between gap-3">
            <Button
              variant="outline"
              isDisabled={stepIndex === 0 || busy !== null}
              onPress={() => goToStep(stepIndex - 1)}
            >
              <ButtonText>Back</ButtonText>
            </Button>
            {stepIndex < WIZARD_STEPS.length - 1 ? (
              <Button
                isDisabled={!canContinue || busy !== null}
                onPress={() => goToStep(stepIndex + 1)}
              >
                <ButtonText>Continue</ButtonText>
              </Button>
            ) : null}
          </Box>
        </Box>

        <Box className="w-full shrink-0 gap-4 lg:w-[336px]">
          <SurfaceCard title="Course setup" subtitle="What this course will be built from.">
            <SummaryItem label="Institution" value={institutionName} />
            <SummaryItem
              label="Source material"
              value={`${selectedDocs.length} document${selectedDocs.length === 1 ? "" : "s"}${
                selectedPageCount > 0 ? ` · ${selectedPageCount} pages` : ""
              }`}
            />
            {selectedDocs.slice(0, 3).map((doc) => (
              <SourceDocSummaryTitle key={doc._id} doc={doc} />
            ))}
            <SummaryItem
              label="Media included"
              value={`${selectedAssets.length} of ${catalogueAssets.length} items`}
            />
          </SurfaceCard>

          {stepIndex > 0 ? (
            <SurfaceCard title="Media selection">
              <Box className="gap-2">
                <Box className="flex-row items-baseline justify-between gap-3">
                  <Text className="text-sm font-bold text-foreground">
                    {selectedAssets.length} of {catalogueAssets.length} included
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {catalogueAssets.length > 0
                      ? `${Math.round((selectedAssets.length / catalogueAssets.length) * 100)}%`
                      : "0%"}
                  </Text>
                </Box>
                <MediaProgress
                  total={catalogueAssets.length}
                  cleared={selectedClearedCount}
                  needsRights={selectedNeedsRightsCount}
                />
                <LegendItem tone="success" label={`${selectedClearedCount} included & cleared`} />
                <LegendItem
                  tone="warning"
                  label={`${selectedNeedsRightsCount} included · need a rights check`}
                />
                <LegendItem
                  tone="neutral"
                  label={`${catalogueAssets.length - selectedAssets.length} not included`}
                />
              </Box>
            </SurfaceCard>
          ) : null}

          {selectedNeedsRightsCount > 0 ? (
            <Box className="gap-3 rounded-[14px] border border-accent bg-accent p-4">
              <Text className="text-[12.5px] leading-5 text-accent-foreground">
                <Text className="font-bold">{selectedNeedsRightsCount} included item
                {selectedNeedsRightsCount === 1 ? "" : "s"} need a rights check.</Text> Clear
                them any time before publishing. Generation is not blocked.
              </Text>
              <Button
                size="sm"
                variant="outline"
                className="self-start bg-card"
                onPress={() => {
                  goToStep(1);
                  setAssetFilter("needs-rights");
                  setClearedOnly(false);
                }}
              >
                <ButtonText>Review these {selectedNeedsRightsCount}</ButtonText>
              </Button>
            </Box>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}

function FilterButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      accessibilityState={{ selected: active }}
      onPress={onPress}
    >
      <ButtonText>{label}</ButtonText>
    </Button>
  );
}

function MediaAssetCard({
  asset,
  selected,
  thumbnailUrl,
  onToggle,
}: {
  asset: CourseAsset;
  selected: boolean;
  thumbnailUrl: string | null;
  onToggle: () => void;
}) {
  const name = asset.caption ?? asset.originalName ?? `${asset.kind} asset`;
  const duration =
    asset.durationMs !== undefined ? `${Math.round(asset.durationMs / 1000)}s` : null;

  return (
    <label
      style={{
        background: selected
          ? asset.cleared
            ? "var(--color-background)"
            : "var(--color-accent)"
          : "var(--color-card)",
        border: selected
          ? `1.5px solid var(${asset.cleared ? "--color-primary" : "--color-accent-foreground"})`
          : "1px solid var(--color-border)",
        borderRadius: 12,
        cursor: "pointer",
        display: "block",
        opacity: selected ? 1 : 0.74,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          aspectRatio: "16 / 9",
          background: "var(--color-muted)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={name}
            style={{ height: "100%", objectFit: "cover", width: "100%" }}
          />
        ) : (
          <div
            style={{
              alignItems: "center",
              color: "var(--color-muted-foreground)",
              display: "flex",
              fontSize: 12,
              height: "100%",
              justifyContent: "center",
            }}
          >
            No preview
          </div>
        )}
        <span
          style={{
            background: "rgba(31, 30, 27, 0.82)",
            borderRadius: 5,
            color: "white",
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: 9.5,
            left: 8,
            padding: "2px 6px",
            position: "absolute",
            textTransform: "uppercase",
            top: 8,
          }}
        >
          {asset.kind === "video" ? `video${duration ? ` · ${duration}` : ""}` : "image"}
        </span>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`${selected ? "Exclude" : "Include"} ${name}`}
          onChange={onToggle}
          style={{
            accentColor: "var(--color-primary)",
            height: 20,
            position: "absolute",
            right: 8,
            top: 8,
            width: 20,
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 11px 12px" }}>
        <span
          style={{
            color: "var(--color-foreground)",
            fontSize: 12,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={name}
        >
          {name}
        </span>
        <span
          style={{
            alignSelf: "flex-start",
            background: asset.cleared
              ? "var(--color-success-muted)"
              : "var(--color-accent)",
            borderRadius: 999,
            color: asset.cleared
              ? "var(--color-success-muted-foreground)"
              : "var(--color-accent-foreground)",
            fontSize: 10.5,
            fontWeight: 600,
            padding: "3px 9px",
          }}
        >
          {asset.cleared ? `Cleared · ${rightsLabel(asset.rights)}` : "Needs rights check"}
        </span>
      </div>
    </label>
  );
}

function ReviewMetric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <Box
      className={`gap-1 rounded-xl border p-4 ${
        warning ? "border-accent bg-accent" : "border-border bg-card"
      }`}
    >
      <Text
        className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${
          warning ? "text-accent-foreground" : "text-muted-foreground"
        }`}
      >
        {label}
      </Text>
      <Text className={`text-sm font-semibold ${warning ? "text-accent-foreground" : "text-foreground"}`}>
        {value}
      </Text>
    </Box>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <Box className="gap-0.5">
      <Text className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </Text>
      <Text className="text-[13.5px] font-semibold text-foreground">{value}</Text>
    </Box>
  );
}

function MediaProgress({
  total,
  cleared,
  needsRights,
}: {
  total: number;
  cleared: number;
  needsRights: number;
}) {
  const clearedWidth = total > 0 ? `${(cleared / total) * 100}%` : "0%";
  const needsRightsWidth = total > 0 ? `${(needsRights / total) * 100}%` : "0%";
  return (
    <div
      aria-label={`${cleared} cleared and ${needsRights} needing rights checks out of ${total} media items`}
      role="img"
      style={{
        background: "var(--color-muted)",
        borderRadius: 999,
        display: "flex",
        height: 8,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <span style={{ background: "var(--color-success)", width: clearedWidth }} />
      <span style={{ background: "var(--color-accent-foreground)", width: needsRightsWidth }} />
    </div>
  );
}

function LegendItem({
  tone,
  label,
}: {
  tone: "success" | "warning" | "neutral";
  label: string;
}) {
  const color =
    tone === "success"
      ? "var(--color-success)"
      : tone === "warning"
        ? "var(--color-accent-foreground)"
        : "var(--color-border)";
  return (
    <Box className="flex-row items-center gap-2">
      <Box className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <Text className="text-xs text-secondary-foreground">{label}</Text>
    </Box>
  );
}

function SourceDocTitle({
  doc,
  factReview,
}: {
  doc: Doc<"sourceDocs">;
  factReview: SourceDocFactReview | undefined;
}) {
  const detail = useQuery(api.pipeline.queries.getSourceDoc, { sourceDocId: doc._id });
  const title = inferSourceDocTitle(doc, detail?.slides?.[0]?.text);
  const factLabel = factReviewLabel(factReview);
  return (
    <>
      <Text className="text-[13.5px] font-semibold text-foreground" numberOfLines={1}>
        {title}
      </Text>
      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        {doc.pageCount !== undefined ? `${doc.pageCount} pages · ` : ""}
        {doc.status === "converted" ? "converted" : doc.status}
        {factLabel ? ` · ${factLabel}` : ""}
      </Text>
    </>
  );
}

function isDocReadyForGeneration(
  doc: Doc<"sourceDocs">,
  factReview: SourceDocFactReview | undefined
): boolean {
  return doc.status === "converted" && factReview?.status === "approved";
}

function factReviewLabel(factReview: SourceDocFactReview | undefined): string | null {
  if (!factReview) return "fact status loading";
  if (factReview.status === "approved") return "facts approved";
  if (factReview.status === "needs_review") {
    return `${factReview.facts.pendingCandidates} fact(s) need review`;
  }
  if (factReview.status === "extracting_facts") return "extracting facts";
  return "conversion pending";
}

function SourceDocSummaryTitle({ doc }: { doc: Doc<"sourceDocs"> }) {
  const detail = useQuery(api.pipeline.queries.getSourceDoc, { sourceDocId: doc._id });
  const title = inferSourceDocTitle(doc, detail?.slides?.[0]?.text);
  return (
    <Box className="rounded-md border border-border bg-background px-2 py-1">
      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        {title}
      </Text>
    </Box>
  );
}

function getAssetThumbnailKey(asset: CourseAsset): string | null {
  return asset.thumbKey ?? (asset.kind === "image" ? asset.objectKey : null);
}

function rightsLabel(rights: string | undefined): string {
  if (rights === "institution_owned") return "Institution owned";
  if (rights === "licensed") return "Licensed";
  return "Rights unknown";
}

function inferSourceDocTitle(doc: Doc<"sourceDocs">, firstSlideText?: string): string {
  if (typeof doc.originalFilename === "string" && doc.originalFilename.trim().length > 0) {
    return doc.originalFilename.trim();
  }

  const objectTitle = titleFromObjectKey(doc.objectKey);
  if (objectTitle !== null) return objectTitle;

  if (firstSlideText) {
    const extracted = extractTitleFromText(firstSlideText);
    if (extracted) return extracted;
  }

  return `${TITLE_FALLBACK} ${doc.objectKey.slice(7, 15)}…`;
}

function titleFromObjectKey(objectKey: string): string | null {
  const lastPart = objectKey.split("/").at(-1) ?? "";
  if (!lastPart) return null;

  const nameWithoutExt = lastPart.replace(/\.[a-z0-9]+$/i, "");
  if (/^[0-9a-f]{64}$/i.test(nameWithoutExt)) return null;

  return humanizeTitle(nameWithoutExt);
}

function extractTitleFromText(text: string): string | null {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 6);

  const firstLine = lines.find((line) => /[a-z]/i.test(line));
  if (!firstLine) return null;

  return firstLine.slice(0, 96);
}

function humanizeTitle(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
