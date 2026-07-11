"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  Input,
  InputField,
  Pressable,
  ScrollView,
  SurfaceCard,
  Text,
} from "@counseliq/ui";
import { Image, Platform } from "react-native";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

type DetailTab = "extraction" | "facts" | "history";

type SourceDocFact = {
  pageN: number;
  factIndex: number;
  statement: string;
  claimClass: string;
  conceptKey: string;
  provenance: string[];
  sourceLabel?: string;
  year?: number;
  flagged: boolean;
  excluded: boolean;
  thumbKey?: string;
};

type SourceDocFactUpdate = {
  statement?: string | null;
  sourceLabel?: string | null;
  year?: number | null;
  excluded?: boolean;
  institutionAsserted?: boolean;
};

type SourceDocFactMutationInput = SourceDocFactUpdate & {
  pageN: number;
  factIndex: number;
};

export function AdminSourceDocDetailScreen() {
  return (
    <AdminGuard>
      <AdminSourceDocDetailContent />
    </AdminGuard>
  );
}

function AdminSourceDocDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sourceDocId = params?.id as Id<"sourceDocs"> | undefined;

  const result = useQuery(
    api.pipeline.queries.getSourceDoc,
    sourceDocId ? { sourceDocId } : "skip"
  );
  const summary = useQuery(
    api.pipeline.queries.getSourceDocSummary,
    sourceDocId ? { sourceDocId } : "skip"
  );
  const sourceDocFacts = useQuery(
    api.pipeline.queries.getSourceDocFacts,
    sourceDocId ? { sourceDocId } : "skip"
  );
  const allDocs = useQuery(api.pipeline.queries.listSourceDocs, {});

  const presignBatch = useAction(api.pipeline.objectStore.adminPresignGetBatch);
  const requestConversions = useMutation(
    api.pipeline.ingestion.adminRequestSourceDocConversions
  );
  const updateSourceDocFact = useMutation(api.pipeline.queries.adminUpdateSourceDocFact);
  const approveSourceDocFacts = useMutation(
    api.pipeline.queries.adminApproveAllSourceDocFacts
  );

  const [urls, setUrls] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<DetailTab>("facts");
  const [previewPage, setPreviewPage] = useState<number>(0);
  const [lowConfidenceOnly, setLowConfidenceOnly] = useState(false);
  const [busy, setBusy] = useState<"download" | "reextract" | null>(null);
  const [bulkApprovingFacts, setBulkApprovingFacts] = useState<"safe" | "all" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doc = result?.doc;
  const slides = result?.slides ?? [];

  useEffect(() => {
    if (!doc) return;
    const keys = [
      ...slides.flatMap((slide) => [slide.pngKey, ...(slide.thumbKey ? [slide.thumbKey] : [])]),
    ];
    if (keys.length === 0) return;

    let cancelled = false;
    presignBatch({ keys })
      .then((entries) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const entry of entries) map[entry.key] = entry.url;
        setUrls(map);
      })
      .catch(() => {
        // object store may not be available in local env
      });
    return () => {
      cancelled = true;
    };
  }, [doc, slides, presignBatch]);

  const relatedUploads = useMemo(() => {
    if (!doc || !allDocs) return [];
    return allDocs
      .filter((candidate) => {
        if (candidate.institutionId !== doc.institutionId) return false;
        if (candidate._id === doc._id) return true;
        if (doc.sourceDocHash && candidate.sourceDocHash) {
          return candidate.sourceDocHash === doc.sourceDocHash;
        }
        return candidate.objectKey === doc.objectKey;
      })
      .sort((left, right) => right._creationTime - left._creationTime);
  }, [allDocs, doc]);

  const displayedSlides = useMemo(() => {
    const list = lowConfidenceOnly ? slides.filter(isLowConfidenceSlide) : slides;
    return list;
  }, [lowConfidenceOnly, slides]);

  const previewSlide = displayedSlides[Math.min(previewPage, Math.max(displayedSlides.length - 1, 0))];

  const lowConfidenceCount = useMemo(
    () => slides.filter(isLowConfidenceSlide).length,
    [slides]
  );

  const cleanCount = Math.max(0, slides.length - lowConfidenceCount);

  useEffect(() => {
    setPreviewPage(0);
  }, [lowConfidenceOnly, sourceDocId]);

  async function handleDownload() {
    if (!doc || Platform.OS !== "web") return;
    setBusy("download");
    setError(null);
    try {
      const [entry] = await presignBatch({ keys: [doc.objectKey] });
      const win = (globalThis as { window?: Window }).window;
      if (entry?.url && win) {
        win.open(entry.url, "_blank", "noopener,noreferrer");
      }
    } catch (downloadError) {
      setError(getUserFacingErrorMessage(downloadError, "Could not download document."));
    } finally {
      setBusy(null);
    }
  }

  async function handleReextract() {
    if (!sourceDocId) return;
    setBusy("reextract");
    setError(null);
    setNotice(null);
    try {
      const result = await requestConversions({ sourceDocIds: [sourceDocId], force: true });
      setNotice(
        result.queued > 0
          ? "Re-extraction queued. Refresh in a few moments."
          : "Document is already converted."
      );
    } catch (reextractError) {
      setError(
        getUserFacingErrorMessage(reextractError, "Could not queue re-extraction.")
      );
    } finally {
      setBusy(null);
    }
  }

  async function copyHash() {
    if (Platform.OS !== "web" || !doc) return;
    const value = doc.sourceDocHash ?? doc.objectKey;
    try {
      const nav = (globalThis as { navigator?: Navigator }).navigator;
      if (nav?.clipboard) {
        await nav.clipboard.writeText(value);
        setNotice("Hash copied.");
      }
    } catch {
      setError("Could not copy hash.");
    }
  }

  async function runBulkFactApproval(includeRisky: boolean) {
    if (!sourceDocId) return;
    if (includeRisky && Platform.OS === "web") {
      const win = (globalThis as { window?: Window }).window;
      const confirmed =
        win?.confirm?.(
          "Approve all facts, including risky claims without attribution checks?"
        ) ?? true;
      if (!confirmed) return;
    }
    setBulkApprovingFacts(includeRisky ? "all" : "safe");
    setError(null);
    try {
      const result = await approveSourceDocFacts({
        sourceDocId,
        ...(includeRisky ? { includeRisky: true } : {}),
      });
      if (includeRisky) {
        const details = [
          `${result.approved} approved`,
          `${result.approvedRisky} risky approved`,
          `${result.skippedExcluded} excluded`,
        ];
        setNotice(`All-facts review complete: ${details.join(" · ")}.`);
      } else {
        const details = [
          `${result.approved} approved`,
          `${result.skippedRisky} risky pending`,
          `${result.skippedExcluded} excluded`,
        ];
        setNotice(`Safe facts review complete: ${details.join(" · ")}.`);
      }
    } catch (bulkError) {
      setError(
        getUserFacingErrorMessage(
          bulkError,
          includeRisky
            ? "Could not approve all facts. Please try again."
            : "Could not approve safe facts. Please try again."
        )
      );
    } finally {
      setBulkApprovingFacts(null);
    }
  }

  const title = doc ? deriveDocTitle(doc) : "Source document";

  return (
    <AdminWorkspaceFrame
      activeNav="source-docs"
      title={title}
      description={
        doc
          ? `${doc.pageCount ?? 0} pages · ${summary?.extractedPagesAcrossRuns ?? 0} pages extracted across all course generations`
          : "Source documents"
      }
      topbarTrail={["Source documents", title]}
      headerActions={
        <>
          <Button variant="outline" isDisabled={!doc || busy === "download"} onPress={handleDownload}>
            <ButtonText>{busy === "download" ? "Downloading..." : "Download"}</ButtonText>
          </Button>
          <Button variant="outline" isDisabled={!doc || busy === "reextract"} onPress={handleReextract}>
            <ButtonText>{busy === "reextract" ? "Queueing..." : "Re-extract"}</ButtonText>
          </Button>
        </>
      }
    >
      {result === undefined ? (
        <SurfaceCard>
          <Text className="text-muted-foreground">Loading document...</Text>
        </SurfaceCard>
      ) : result === null || !doc ? (
        <SurfaceCard>
          <Text className="text-muted-foreground">Document not found.</Text>
        </SurfaceCard>
      ) : (
        <ScrollView className="flex-1 w-full">
          <Box className="gap-4 pb-4">
            {notice ? <Text className="text-sm text-[#1f7a45]">{notice}</Text> : null}
            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}

            <SurfaceCard>
              <Box className="flex-row items-center gap-3">
                <Box className="h-14 w-14 rounded-lg border border-border bg-background items-center justify-center">
                  <Text className="text-sm font-semibold uppercase">{doc.kind}</Text>
                </Box>
                <Box className="flex-1">
                  <Box className="flex-row items-center gap-2 flex-wrap">
                    <Text className="text-2xl font-bold text-foreground">{title}</Text>
                    <StatusChip
                      label={
                        doc.status === "converted"
                          ? "Converted"
                          : doc.status === "failed"
                            ? "Conversion failed"
                            : "Converting"
                      }
                      tone={
                        doc.status === "converted"
                          ? "success"
                          : doc.status === "failed"
                            ? "danger"
                            : "warning"
                      }
                    />
                  </Box>
                  <Text className="text-sm text-muted-foreground">
                    {doc.pageCount ?? 0} pages · ingest history {summary?.ingestHistoryCount ?? relatedUploads.length}
                  </Text>
                  <Box className="flex-row items-center gap-2 flex-wrap mt-1">
                    <Text className="text-xs text-muted-foreground">
                      sha256 {shortHash(doc.sourceDocHash ?? doc.objectKey, 32)}
                    </Text>
                    <Pressable onPress={() => void copyHash()}>
                      <Text className="text-xs font-semibold text-foreground">Copy</Text>
                    </Pressable>
                  </Box>
                </Box>
              </Box>
            </SurfaceCard>

            <Box className="flex-row items-center gap-6 border-b border-border pb-2">
              <DetailTabButton
                label="Extraction"
                active={activeTab === "extraction"}
                onPress={() => setActiveTab("extraction")}
              />
              <DetailTabButton
                label={`Facts derived · ${summary?.facts.total ?? 0}`}
                active={activeTab === "facts"}
                onPress={() => setActiveTab("facts")}
              />
              <DetailTabButton
                label={`Ingest history · ${summary?.ingestHistoryCount ?? relatedUploads.length}`}
                active={activeTab === "history"}
                onPress={() => setActiveTab("history")}
              />
            </Box>

            {activeTab === "extraction" ? (
              <Box className="flex-row gap-4 items-start flex-wrap">
                <Box className="min-w-[520px] flex-1 gap-4">
                  <SurfaceCard
                    title="Page-level extraction"
                    actions={
                      <Box className="flex-row items-center gap-3">
                        <Text className="text-sm font-semibold">{slides.length} pages</Text>
                        <Text className="text-sm text-[#1f7a45] font-semibold">{cleanCount} clean</Text>
                        <Text className="text-sm text-[#8A5B12] font-semibold">
                          {lowConfidenceCount} low-confidence
                        </Text>
                      </Box>
                    }
                  >
                    {displayedSlides.length === 0 ? (
                      <Text className="text-sm text-muted-foreground">No extracted pages yet.</Text>
                    ) : (
                      <>
                        <Box className="flex-row gap-3 flex-wrap">
                          {displayedSlides.slice(0, 8).map((slide, index) => {
                            const active = previewSlide?._id === slide._id;
                            const low = isLowConfidenceSlide(slide);
                            return (
                              <Pressable
                                key={slide._id}
                                onPress={() => setPreviewPage(index)}
                                className={`w-36 gap-1 ${active ? "" : "opacity-85"}`}
                              >
                                <Box
                                  className={`h-24 rounded-lg border overflow-hidden ${
                                    active ? "border-primary" : "border-border"
                                  }`}
                                >
                                  {urls[slide.thumbKey ?? slide.pngKey] ? (
                                    <Image
                                      source={{ uri: urls[slide.thumbKey ?? slide.pngKey] }}
                                      resizeMode="cover"
                                      style={{ width: "100%", height: "100%" }}
                                    />
                                  ) : (
                                    <Box className="flex-1 bg-background" />
                                  )}
                                </Box>
                                <Text className="text-xs text-muted-foreground text-center">
                                  p.{slide.n}
                                  {low ? " · low" : ""}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </Box>
                        <Box className="flex-row items-center gap-3 flex-wrap mt-2">
                          <Text className="text-sm text-muted-foreground">
                            Showing {Math.min(displayedSlides.length, 8)} of {displayedSlides.length} pages
                          </Text>
                          <Pressable onPress={() => openSlideInNewTab(previewSlide, urls, presignBatch)}>
                            <Text className="text-sm font-semibold text-foreground">Open page browser</Text>
                          </Pressable>
                          <Pressable onPress={() => setLowConfidenceOnly((value) => !value)}>
                            <Text className="text-sm font-semibold text-foreground">
                              {lowConfidenceOnly
                                ? "Show all pages"
                                : "Show low-confidence only"}
                            </Text>
                          </Pressable>
                        </Box>
                      </>
                    )}
                  </SurfaceCard>

                  <SurfaceCard
                    title={`Extracted text preview${previewSlide ? ` · p.${previewSlide.n}` : ""}`}
                  >
                    <Text className="text-base leading-7 text-foreground" numberOfLines={6}>
                      {previewSlide?.text?.trim() || "No extracted text available on this page."}
                    </Text>
                    {previewSlide?.notes ? (
                      <Text className="text-sm text-muted-foreground" numberOfLines={3}>
                        Notes: {previewSlide.notes}
                      </Text>
                    ) : null}
                  </SurfaceCard>
                </Box>

                <Box className="w-[390px] gap-4">
                  <UsedInRunsCard runs={summary?.runs ?? []} />
                  <FactsSummaryCard
                    facts={summary?.facts ?? {
                      total: 0,
                      approvedWithSource: 0,
                      institutionAsserted: 0,
                      excluded: 0,
                      extractedCandidates: 0,
                      pendingCandidates: 0,
                    }}
                    runCount={summary?.runs.length ?? 0}
                  />
                </Box>
              </Box>
            ) : null}

            {activeTab === "facts" ? (
              <Box className="gap-4">
                <FactsSummaryCard
                  facts={summary?.facts ?? {
                    total: 0,
                    approvedWithSource: 0,
                    institutionAsserted: 0,
                    excluded: 0,
                    extractedCandidates: 0,
                    pendingCandidates: 0,
                  }}
                  runCount={summary?.runs.length ?? 0}
                />
                <Box className="flex-row items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    isDisabled={
                      bulkApprovingFacts !== null ||
                      !sourceDocId ||
                      (sourceDocFacts?.length ?? 0) === 0
                    }
                    onPress={() => void runBulkFactApproval(false)}
                  >
                    <ButtonText>
                      {bulkApprovingFacts === "safe"
                        ? "Approving..."
                        : "Approve all safe facts"}
                    </ButtonText>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    isDisabled={
                      bulkApprovingFacts !== null ||
                      !sourceDocId ||
                      (sourceDocFacts?.length ?? 0) === 0
                    }
                    onPress={() => void runBulkFactApproval(true)}
                  >
                    <ButtonText>
                      {bulkApprovingFacts === "all"
                        ? "Approving..."
                        : "Approve all facts"}
                    </ButtonText>
                  </Button>
                  <Text className="text-xs text-muted-foreground">
                    Safe review keeps risky claims pending.
                  </Text>
                  <Text className="text-xs text-destructive">
                    Use "Approve all facts" to clear blocked approvals in one pass.
                  </Text>
                </Box>
                <SourceDocFactsManager
                  facts={sourceDocFacts ?? []}
                  urls={urls}
                  onSave={async (update) => {
                    if (!sourceDocId) return;
                    setError(null);
                    try {
                      await updateSourceDocFact({ sourceDocId, ...update });
                      setNotice("Fact updated.");
                    } catch (factError) {
                      setError(
                        getUserFacingErrorMessage(
                          factError,
                          "Could not update fact. Please try again."
                        )
                      );
                    }
                  }}
                />
              </Box>
            ) : null}

            {activeTab === "history" ? (
              <SurfaceCard title={`Ingest history · ${relatedUploads.length}`}>
                {relatedUploads.length === 0 ? (
                  <Text className="text-sm text-muted-foreground">No ingest history yet.</Text>
                ) : (
                  <Box>
                    {relatedUploads.map((upload) => (
                      <Box
                        key={upload._id}
                        className="flex-row items-center gap-3 border-t border-border py-3 first:border-t-0"
                      >
                        <Text className="w-40 text-xs font-mono text-muted-foreground" numberOfLines={1}>
                          {historyId(upload)}
                        </Text>
                        <Text className="w-28 text-sm text-muted-foreground">
                          {historyDate(upload._creationTime)}
                        </Text>
                        <Box className="flex-1">
                          <Text className="text-sm" numberOfLines={1}>
                            {upload.runId
                              ? `Included in ${summary?.runs.find((run) => run._id === upload.runId)?.title ?? `Course ${String(upload.runId).slice(0, 8)}`}`
                              : "Uploaded"}
                          </Text>
                        </Box>
                        <Pressable onPress={() => router.push(`/admin/source-docs/${upload._id}`)}>
                          <Text className="text-sm font-semibold text-foreground">Open →</Text>
                        </Pressable>
                      </Box>
                    ))}
                  </Box>
                )}
              </SurfaceCard>
            ) : null}
          </Box>
        </ScrollView>
      )}
    </AdminWorkspaceFrame>
  );
}

function DetailTabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className={`pb-2 ${active ? "border-b-2 border-foreground" : ""}`}>
      <Text className={`text-sm font-semibold ${active ? "text-foreground" : "text-muted-foreground"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function StatusChip({ label, tone }: { label: string; tone: "success" | "warning" | "danger" }) {
  const className =
    tone === "success"
      ? "bg-[#EAF5EA]"
      : tone === "warning"
        ? "bg-[#F4EFE1]"
        : "bg-[#FAE9E5]";
  const textClassName =
    tone === "success"
      ? "text-[#1f7a45]"
      : tone === "warning"
        ? "text-[#8A5B12]"
        : "text-[#B3362B]";
  return (
    <Box className={`rounded-full px-2.5 py-1 ${className}`}>
      <Text className={`text-xs font-semibold ${textClassName}`}>{label}</Text>
    </Box>
  );
}

function UsedInRunsCard({
  runs,
}: {
  runs: Array<{ _id: Id<"runs">; state: string; title: string }>;
}) {
  return (
    <SurfaceCard title={`Used in courses · ${runs.length}`}>
      {runs.length === 0 ? (
        <Text className="text-sm text-muted-foreground">Not used in course generation yet.</Text>
      ) : (
        <Box>
          {runs.slice(0, 5).map((run) => (
            <Box key={run._id} className="flex-row items-center gap-2 border-t border-border py-2 first:border-t-0">
              <Box className="flex-1">
                <Text className="font-semibold" numberOfLines={1}>
                  {run.title}
                </Text>
                <Text className="text-xs text-muted-foreground">{runStateLabel(run.state)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </SurfaceCard>
  );
}

function FactsSummaryCard({
  facts,
  runCount,
}: {
  facts: {
    total: number;
    approvedWithSource: number;
    institutionAsserted: number;
    excluded: number;
    extractedCandidates: number;
    pendingCandidates: number;
  };
  runCount: number;
}) {
  return (
    <SurfaceCard title={`Facts derived · ${facts.total}`}>
      {runCount === 0 ? (
        <Text className="text-sm text-muted-foreground">
          {facts.extractedCandidates > 0
            ? `${facts.extractedCandidates} fact candidate(s) extracted from this upload.`
            : "Fact extraction is running in the background after upload."}
        </Text>
      ) : (
        <Text className="text-sm text-muted-foreground">
          Facts refresh automatically as course generations progress.
        </Text>
      )}
      {runCount === 0 ? (
        <StatRow label="Extracted candidates" value={String(facts.extractedCandidates)} success />
      ) : null}
      {runCount === 0 ? (
        <StatRow label="Pending review" value={String(facts.pendingCandidates)} />
      ) : null}
      <StatRow label="Approved with source" value={String(facts.approvedWithSource)} success />
      <StatRow label="Institution-asserted" value={String(facts.institutionAsserted)} />
      <StatRow label="Excluded" value={String(facts.excluded)} />
    </SurfaceCard>
  );
}

function SourceDocFactsManager({
  facts,
  urls,
  onSave,
}: {
  facts: SourceDocFact[];
  urls: Record<string, string>;
  onSave: (update: SourceDocFactMutationInput) => Promise<void>;
}) {
  const ordered = [...facts].sort((left, right) => {
    if (left.pageN !== right.pageN) return left.pageN - right.pageN;
    return left.factIndex - right.factIndex;
  });

  return (
    <SurfaceCard
      title={`Fact manager · ${ordered.length}`}
      subtitle="Review extracted facts, add attribution, edit wording, and exclude incorrect statements."
    >
      {ordered.length === 0 ? (
        <Text className="text-sm text-muted-foreground">No extracted facts yet.</Text>
      ) : (
        <Box>
          {ordered.map((fact) => (
            <SourceDocFactRow
              key={`${fact.pageN}-${fact.factIndex}`}
              fact={fact}
              thumbUrl={fact.thumbKey ? urls[fact.thumbKey] ?? null : null}
              onSave={onSave}
            />
          ))}
        </Box>
      )}
    </SurfaceCard>
  );
}

function SourceDocFactRow({
  fact,
  thumbUrl,
  onSave,
}: {
  fact: SourceDocFact;
  thumbUrl: string | null;
  onSave: (update: SourceDocFactMutationInput) => Promise<void>;
}) {
  const [statement, setStatement] = useState(fact.statement);
  const [sourceLabel, setSourceLabel] = useState(fact.sourceLabel ?? "");
  const [year, setYear] = useState(
    fact.year !== undefined ? String(fact.year) : ""
  );
  const [busy, setBusy] = useState(false);

  const yearValid = /^\d{4}$/.test(year.trim());

  async function save(update: SourceDocFactUpdate) {
    setBusy(true);
    try {
      await onSave({
        pageN: fact.pageN,
        factIndex: fact.factIndex,
        ...update,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box className="border-t border-border py-3 first:border-t-0 gap-2">
      <Box className="flex-row gap-3 items-start">
        {thumbUrl ? (
          <Image
            source={{ uri: thumbUrl }}
            resizeMode="cover"
            style={{ width: 84, height: 56, borderRadius: 8 }}
          />
        ) : null}
        <Box className="flex-1 gap-1">
          <Text className="text-xs text-muted-foreground">
            p.{fact.pageN} · {fact.claimClass.replaceAll("_", " ")}
          </Text>
          <Input>
            <InputField value={statement} onChangeText={setStatement} />
          </Input>
          <Text className="text-xs text-muted-foreground" numberOfLines={2}>
            {fact.provenance.join(", ")}
          </Text>
          <Box className="flex-row items-center gap-2 flex-wrap">
            <StatusInline fact={fact} sourceLabel={sourceLabel} year={year} />
          </Box>
        </Box>
      </Box>

      <Box className="flex-row gap-2 flex-wrap items-center">
        <Box className="min-w-[220px] flex-1">
          <Input>
            <InputField
              placeholder="Source label"
              value={sourceLabel}
              onChangeText={setSourceLabel}
            />
          </Input>
        </Box>
        <Box className="w-28">
          <Input>
            <InputField
              placeholder="Year"
              value={year}
              onChangeText={setYear}
              keyboardType="numeric"
            />
          </Input>
        </Box>
        <Button
          size="sm"
          onPress={() =>
            void save({
              statement,
              sourceLabel: sourceLabel.trim() || null,
              year: yearValid ? Number(year) : null,
            })
          }
          isDisabled={busy || sourceLabel.trim() === "" || !yearValid}
        >
          <ButtonText>Save source</ButtonText>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={() =>
            void save({
              statement,
              sourceLabel: null,
              year: null,
              institutionAsserted: true,
            })
          }
          isDisabled={busy}
        >
          <ButtonText>Institution asserted</ButtonText>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={() => void save({ statement, excluded: !fact.excluded })}
          isDisabled={busy}
        >
          <ButtonText>{fact.excluded ? "Restore" : "Exclude"}</ButtonText>
        </Button>
      </Box>
    </Box>
  );
}

function StatusInline({
  fact,
  sourceLabel,
  year,
}: {
  fact: SourceDocFact;
  sourceLabel: string;
  year: string;
}) {
  if (fact.excluded) {
    return <Text className="text-xs font-semibold text-muted-foreground">Excluded</Text>;
  }
  if (sourceLabel.trim().length > 0 && /^\d{4}$/.test(year.trim())) {
    return <Text className="text-xs font-semibold text-[#1f7a45]">Ready with source</Text>;
  }
  if (!fact.flagged) {
    return <Text className="text-xs font-semibold text-foreground">Institution asserted</Text>;
  }
  return <Text className="text-xs font-semibold text-[#8A5B12]">Needs attribution</Text>;
}

function StatRow({ label, value, success }: { label: string; value: string; success?: boolean }) {
  return (
    <Box className="flex-row items-center justify-between">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className={`text-sm font-semibold ${success ? "text-[#1f7a45]" : "text-foreground"}`}>
        {value}
      </Text>
    </Box>
  );
}

function deriveDocTitle(doc: Doc<"sourceDocs">): string {
  if (typeof doc.originalFilename === "string" && doc.originalFilename.trim().length > 0) {
    return doc.originalFilename.trim();
  }
  const basename = doc.objectKey.split("/").at(-1) ?? doc.objectKey;
  if (!doc.objectKey.startsWith("sha256/")) return basename;
  return `Source-${shortHash(doc.sourceDocHash ?? doc.objectKey, 10)}.${doc.kind.toLowerCase()}`;
}

function shortHash(value: string, size = 8): string {
  const cleaned = value.replace("sha256/", "").replace(/\.[a-z0-9]+$/i, "");
  return cleaned.slice(0, size);
}

function historyDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function historyId(doc: Doc<"sourceDocs">): string {
  const key = doc.objectKey.split("/").at(-1) ?? String(doc._id);
  return key.slice(0, 14);
}

function isLowConfidenceSlide(slide: { text: string; notes: string }): boolean {
  const textScore = slide.text.trim().length;
  const notesScore = slide.notes.trim().length;
  return textScore + notesScore < 180;
}

async function openSlideInNewTab(
  slide: { pngKey: string } | undefined,
  urls: Record<string, string>,
  presignBatch: (args: { keys: string[] }) => Promise<Array<{ key: string; url: string }>>
) {
  if (!slide || Platform.OS !== "web") return;
  const win = (globalThis as { window?: Window }).window;
  if (!win) return;

  const current = urls[slide.pngKey];
  if (current) {
    win.open(current, "_blank", "noopener,noreferrer");
    return;
  }

  const [entry] = await presignBatch({ keys: [slide.pngKey] });
  if (entry?.url) {
    win.open(entry.url, "_blank", "noopener,noreferrer");
  }
}

function runStateLabel(state: string): string {
  if (state === "OUTLINE_REVIEW") return "Outline approval · in review";
  if (state === "GATE_2_COURSE_REVIEW") return "Course approval · in review";
  if (state === "GATE_3_PREVIEW") return "Preview approval · in review";
  if (state === "PUBLISHED") return "Published";
  if (state === "FAILED") return "Blocked";
  return state.replaceAll("_", " ").toLowerCase();
}
