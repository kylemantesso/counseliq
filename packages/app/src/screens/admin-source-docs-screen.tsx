"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "solito/navigation";
import { Platform } from "react-native";
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
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { useSelectedInstitution } from "../components/admin/use-selected-institution";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
import { api } from "../db/api";
import {
  getUserFacingErrorMessage,
  parseAppErrorCode,
} from "../errors/get-user-facing-message";

type FilterKey = "all" | "converted" | "processing" | "attention";
type RowState = "converted" | "processing" | "attention";

type SourceDocFactReview = {
  sourceDocId: Id<"sourceDocs">;
  status: string;
  llmConfigured: boolean;
  extractedPages: number;
  expectedPages: number;
  facts: {
    pendingCandidates: number;
  };
  titleHint?: string;
  llmUsage: {
    tracked: boolean;
    calls: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    lastCallAt?: number;
  };
};

type SourceDocRow = {
  key: string;
  latest: Doc<"sourceDocs">;
  uploads: Doc<"sourceDocs">[];
  approvableUploadIds: Id<"sourceDocs">[];
  title: string;
  state: RowState;
  runIds: Id<"runs">[];
  factReview?: SourceDocFactReview;
};

const DOC_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

async function contentKeyForFile(file: File): Promise<{ key: string; ext: string; bytes: ArrayBuffer }> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  return { key: `sha256/${hex}.${ext}`, ext, bytes };
}

export function AdminSourceDocsScreen() {
  return (
    <AdminGuard>
      <AdminSourceDocsContent />
    </AdminGuard>
  );
}

function AdminSourceDocsContent() {
  const router = useRouter();
  const { selectedInstitution, selectedInstitutionId } = useSelectedInstitution();

  const docs = useQuery(api.pipeline.queries.listSourceDocs, {});
  const factReviews = useQuery(
    api.pipeline.queries.listSourceDocFactReviews,
    selectedInstitutionId ? { institutionId: selectedInstitutionId } : "skip"
  );
  const presignPutBatch = useAction(api.pipeline.objectStore.adminPresignPutBatch);
  const registerDoc = useMutation(api.pipeline.ingestion.adminRegisterSourceDoc);
  const requestConversions = useMutation(
    api.pipeline.ingestion.adminRequestSourceDocConversions
  );
  const approveSourceDocFacts = useMutation(
    api.pipeline.queries.adminApproveAllSourceDocFacts
  );
  const runs = useQuery(
    api.pipeline.queries.adminListRuns,
    selectedInstitutionId ? { institutionId: selectedInstitutionId } : "skip"
  );

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [autoQueuedPending, setAutoQueuedPending] = useState(false);
  const [bulkApproveDocId, setBulkApproveDocId] = useState<Id<"sourceDocs"> | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [bulkApprovalUnavailable, setBulkApprovalUnavailable] = useState(false);

  const runNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of runs ?? []) {
      map.set(
        String(run._id),
        run.courseTitle?.trim() || `Course ${String(run._id).slice(0, 8)}`
      );
    }
    return map;
  }, [runs]);

  const docsForInstitution = useMemo(() => {
    if (!docs || !selectedInstitutionId) return [];
    return docs.filter((doc) => doc.institutionId === selectedInstitutionId);
  }, [docs, selectedInstitutionId]);

  const rows = useMemo(() => {
    const factReviewByDocId = new Map<string, SourceDocFactReview>();
    for (const review of (factReviews ?? []) as SourceDocFactReview[]) {
      factReviewByDocId.set(String(review.sourceDocId), review);
    }

    const byGroup = new Map<string, Doc<"sourceDocs">[]>();
    for (const doc of docsForInstitution) {
      const key = doc.sourceDocHash ?? doc.objectKey;
      const list = byGroup.get(key) ?? [];
      list.push(doc);
      byGroup.set(key, list);
    }

    const grouped: SourceDocRow[] = [];
    for (const [key, uploads] of byGroup.entries()) {
      const sorted = [...uploads].sort((left, right) => right._creationTime - left._creationTime);
      const latest = sorted[0];
      if (!latest) continue;
      const runIds = [...new Set(sorted.map((doc) => doc.runId).filter((runId): runId is Id<"runs"> => Boolean(runId)))];
      const approvableUploadIds = sorted
        .filter((doc) => {
          const review = factReviewByDocId.get(String(doc._id));
          return (
            doc.status === "converted" &&
            review?.status === "needs_review" &&
            review.facts.pendingCandidates > 0
          );
        })
        .map((doc) => doc._id);

      grouped.push({
        key,
        latest,
        uploads: sorted,
        approvableUploadIds,
        title:
          factReviewByDocId.get(String(latest._id))?.titleHint ??
          deriveDocTitle(latest),
        state: deriveRowState(sorted, factReviewByDocId.get(String(latest._id))),
        runIds,
        factReview: factReviewByDocId.get(String(latest._id)),
      });
    }

    return grouped.sort((left, right) => right.latest._creationTime - left.latest._creationTime);
  }, [docsForInstitution, factReviews]);

  const counts = useMemo(() => {
    const converted = rows.filter((row) => row.state === "converted").length;
    const processing = rows.filter((row) => row.state === "processing").length;
    const attention = rows.filter((row) => row.state === "attention").length;
    return { all: rows.length, converted, processing, attention };
  }, [rows]);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (activeFilter === "converted" && row.state !== "converted") return false;
      if (activeFilter === "processing" && row.state !== "processing") return false;
      if (activeFilter === "attention" && row.state !== "attention") return false;

      if (!needle) return true;

      const runNames = row.runIds
        .map((runId) => runNameById.get(String(runId)) ?? String(runId).slice(0, 8))
        .join(" ")
        .toLowerCase();
      const haystack = [
        row.title,
        row.latest.objectKey,
        row.latest.sourceDocHash ?? "",
        String(row.latest._id),
        runNames,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [activeFilter, rows, runNameById, search]);

  const totalPages = useMemo(
    () => rows.reduce((sum, row) => sum + (row.latest.pageCount ?? 0), 0),
    [rows]
  );

  const loading = docs === undefined;

  useEffect(() => {
    if (autoQueuedPending) return;
    if (!selectedInstitutionId || docs === undefined) return;

    const pendingDocIds = docs
      .filter(
        (doc) =>
          doc.institutionId === selectedInstitutionId &&
          !doc.runId &&
          doc.status === "pending"
      )
      .map((doc) => doc._id);

    if (pendingDocIds.length === 0) {
      setAutoQueuedPending(true);
      return;
    }

    setAutoQueuedPending(true);
    void requestConversions({ sourceDocIds: pendingDocIds })
      .then((result) => {
        if (result.queued > 0) {
          setUploadMessage(
            `Queued conversion for ${result.queued} pending document${result.queued === 1 ? "" : "s"}.`
          );
        }
      })
      .catch((error) => {
        setUploadError(
          getUserFacingErrorMessage(error, "Could not queue pending documents for conversion.")
        );
      });
  }, [autoQueuedPending, docs, requestConversions, selectedInstitutionId]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0 || !selectedInstitutionId) return;
    setUploadError(null);
    setUploadMessage(null);
    setUploading(true);

    try {
      const registeredDocIds: Id<"sourceDocs">[] = [];
      let uploadedCount = 0;
      for (const file of Array.from(files)) {
        const { key, ext, bytes } = await contentKeyForFile(file);
        const contentType = DOC_CONTENT_TYPES[ext];
        if (!contentType) {
          throw new Error(`${file.name}: only .pdf and .pptx are supported`);
        }

        const [put] = await presignPutBatch({ items: [{ key, contentType }] });
        const response = await fetch(put.url, {
          method: "PUT",
          headers: { "content-type": contentType },
          body: bytes,
        });
        if (!response.ok) {
          throw new Error(`Upload failed (${response.status})`);
        }

        const sourceDocId = await registerDoc({
          institutionId: selectedInstitutionId,
          objectKey: key,
          kind: ext as "pdf" | "pptx",
          originalFilename: file.name,
        });
        registeredDocIds.push(sourceDocId);
        uploadedCount += 1;
      }

      if (registeredDocIds.length > 0) {
        await requestConversions({ sourceDocIds: registeredDocIds });
      }

      setUploadMessage(
        `${uploadedCount} document${uploadedCount === 1 ? "" : "s"} uploaded. Processing has started.`
      );
    } catch (error) {
      setUploadError(
        getUserFacingErrorMessage(error, "Could not upload documents. Try again.")
      );
    } finally {
      setUploading(false);
    }
  }

  function openUploadDialog() {
    if (Platform.OS !== "web") return;
    if (!selectedInstitutionId || uploading) return;
    const documentApi = (globalThis as { document?: any }).document;
    if (!documentApi) return;
    const input = documentApi.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";
    input.multiple = true;
    input.onchange = () => {
      void handleUpload(input.files as FileList | null);
    };
    input.click();
  }

  async function approveAllFactsForRow(row: SourceDocRow) {
    if (!canBulkApproveFacts(row)) return;
    const targetDocIds = row.approvableUploadIds;
    if (targetDocIds.length === 0) return;

    if (Platform.OS === "web") {
      const win = (globalThis as { window?: Window }).window;
      const confirmed =
        win?.confirm?.(
          `Approve all facts for "${row.title}", including risky claims without attribution checks?`
        ) ?? true;
      if (!confirmed) return;
    }

    setActionError(null);
    setActionMessage(null);
    setBulkApproveDocId(row.latest._id);
    try {
      let approved = 0;
      let approvedRisky = 0;
      let skippedExcluded = 0;
      let succeeded = 0;
      let firstError: unknown = null;

      for (const sourceDocId of targetDocIds) {
        try {
          const result = await approveSourceDocFacts({
            sourceDocId,
            includeRisky: true,
          });
          approved += result.approved;
          approvedRisky += result.approvedRisky;
          skippedExcluded += result.skippedExcluded;
          succeeded += 1;
        } catch (error) {
          if (!firstError) firstError = error;
        }
      }

      if (succeeded === 0) {
        throw firstError ?? new Error("Bulk approval failed");
      }

      const failed = targetDocIds.length - succeeded;
      setActionMessage(
        `${row.title}: ${approved} approved · ${approvedRisky} risky approved · ${skippedExcluded} excluded.`
      );
      if (failed > 0) {
        setActionError(
          `${failed} related upload${failed === 1 ? "" : "s"} could not be auto-approved. Open the document detail page to review.`
        );
      }
    } catch (error) {
      const appCode = parseAppErrorCode(error);
      if (!appCode) {
        setBulkApprovalUnavailable(true);
        setActionError(
          "Bulk approval is unavailable in this Convex deployment. Run npm run convex:dev (or deploy backend updates), then retry."
        );
      } else {
        setActionError(
          getUserFacingErrorMessage(error, "Could not approve all facts. Please try again.")
        );
      }
    } finally {
      setBulkApproveDocId(null);
    }
  }

  return (
    <AdminWorkspaceFrame
      activeNav="source-docs"
      title="Source documents"
      description={`${rows.length} documents · ${totalPages} pages ingested · identical uploads are de-duplicated by content hash`}
      topbarTrail={["Libraries", "Source documents"]}
      headerActions={
        <Button isDisabled={!selectedInstitutionId || uploading} onPress={openUploadDialog}>
          <ButtonText>{uploading ? "Uploading..." : "Upload documents"}</ButtonText>
        </Button>
      }
    >
      {!selectedInstitution || !selectedInstitutionId ? (
        <SurfaceCard>
          <Text className="text-muted-foreground">
            Select an institution to review source documents.
          </Text>
        </SurfaceCard>
      ) : loading ? (
        <SurfaceCard>
          <Text className="text-muted-foreground">Loading documents...</Text>
        </SurfaceCard>
      ) : (
        <ScrollView className="flex-1 w-full">
          <Box className="gap-4 pb-4">
            <Box className="flex-row items-center gap-3 flex-wrap">
              <Box className="min-w-[260px] flex-1">
                <Input>
                  <InputField
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search by title or hash..."
                  />
                </Input>
              </Box>
              <FilterChip
                label="All"
                count={counts.all}
                active={activeFilter === "all"}
                onPress={() => setActiveFilter("all")}
              />
              <FilterChip
                label="Converted"
                count={counts.converted}
                active={activeFilter === "converted"}
                onPress={() => setActiveFilter("converted")}
              />
              <FilterChip
                label="Processing"
                count={counts.processing}
                active={activeFilter === "processing"}
                onPress={() => setActiveFilter("processing")}
              />
              <FilterChip
                label="Needs attention"
                count={counts.attention}
                active={activeFilter === "attention"}
                onPress={() => setActiveFilter("attention")}
              />
            </Box>
            {uploadMessage ? (
              <Text className="text-sm text-[#1f7a45]">{uploadMessage}</Text>
            ) : null}
            {uploadError ? <Text className="text-sm text-destructive">{uploadError}</Text> : null}
            {actionMessage ? <Text className="text-sm text-[#1f7a45]">{actionMessage}</Text> : null}
            {actionError ? <Text className="text-sm text-destructive">{actionError}</Text> : null}

            {visibleRows.length === 0 ? (
              <SurfaceCard>
                <Text className="text-muted-foreground">No source documents match your filters.</Text>
              </SurfaceCard>
            ) : (
              <Box className="bg-card border border-border rounded-xl overflow-hidden">
                <Box className="px-4 py-3 border-b border-border flex-row items-center gap-3 bg-background">
                  <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em] flex-1 min-w-[260px]">
                    Document
                  </Text>
                  <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em] w-20">
                    Pages
                  </Text>
                  <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em] w-40">
                    Status
                  </Text>
                  <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em] w-52">
                    Used in courses
                  </Text>
                  <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em] w-28">
                    Uploaded
                  </Text>
                  <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em] w-56 text-right">
                    Actions
                  </Text>
                </Box>

                {visibleRows.map((row) => {
                  const canApproveAllFacts =
                    !bulkApprovalUnavailable && canBulkApproveFacts(row);
                  return (
                    <Box key={row.key} className="border-b border-border last:border-b-0">
                      <Box className="px-4 py-3 flex-row items-center gap-3">
                        <Pressable
                          onPress={() => router.push(`/admin/source-docs/${row.latest._id}`)}
                          className="flex-1 min-w-[260px] flex-row items-center gap-3"
                        >
                          <Box className="h-11 w-11 rounded-md border border-border bg-background items-center justify-center">
                            <Text className="text-[10px] font-semibold text-muted-foreground uppercase">
                              {row.latest.kind}
                            </Text>
                          </Box>
                          <Box className="flex-1">
                            <Text className="font-semibold text-foreground" numberOfLines={1}>
                              {row.title}
                            </Text>
                            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                              sha256 {shortHash(row.latest.sourceDocHash ?? row.latest.objectKey)}
                            </Text>
                          </Box>
                        </Pressable>

                        <Box className="w-20">
                          <Text className="font-semibold">{row.latest.pageCount ?? "-"}</Text>
                        </Box>

                        <Box className="w-40">
                          <StatusPill state={row.state} factReview={row.factReview} />
                        </Box>

                        <Box className="w-52">
                          <RunPills runIds={row.runIds} runNameById={runNameById} />
                        </Box>

                        <Box className="w-28">
                          <Text className="text-sm text-muted-foreground">
                            {uploadedLabel(row.latest._creationTime)}
                          </Text>
                        </Box>

                        <Box className="w-56 items-end gap-2">
                          {canApproveAllFacts ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              isDisabled={bulkApproveDocId !== null}
                              onPress={() => void approveAllFactsForRow(row)}
                            >
                              <ButtonText>
                                {bulkApproveDocId === row.latest._id
                                  ? "Approving..."
                                  : "Approve all facts"}
                              </ButtonText>
                            </Button>
                          ) : null}
                          <Pressable onPress={() => router.push(`/admin/source-docs/${row.latest._id}`)}>
                            <Text className="text-sm font-semibold text-foreground">
                              Open
                            </Text>
                          </Pressable>
                        </Box>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}

            <Text className="text-sm text-muted-foreground">
              {docsForInstitution.length} uploads map to {rows.length} documents — re-uploading an identical file links to the existing record instead of duplicating it.
            </Text>
            <Text className="text-sm text-muted-foreground">
              Use row-level "Approve all facts" to clear blocked document approvals without opening each detail page.
            </Text>
          </Box>
        </ScrollView>
      )}
    </AdminWorkspaceFrame>
  );
}

function deriveRowState(
  docs: Doc<"sourceDocs">[],
  factReview: SourceDocFactReview | undefined
): RowState {
  if (docs.some((doc) => doc.status === "failed")) return "attention";
  if (docs.some((doc) => doc.status === "pending" || doc.status === "converting")) {
    return "processing";
  }
  if (
    factReview?.status === "extracting_facts" &&
    factReview.llmConfigured === false
  ) {
    return "attention";
  }
  if (!factReview || factReview.status === "extracting_facts") return "processing";
  if (factReview.status === "needs_review") return "attention";
  return "converted";
}

function canBulkApproveFacts(row: SourceDocRow): boolean {
  return (
    row.latest.status === "converted" &&
    row.factReview?.status === "needs_review" &&
    row.factReview.facts.pendingCandidates > 0
  );
}

function deriveDocTitle(doc: Doc<"sourceDocs">): string {
  if (typeof doc.originalFilename === "string" && doc.originalFilename.trim().length > 0) {
    return doc.originalFilename.trim();
  }
  const basename = doc.objectKey.split("/").at(-1) ?? doc.objectKey;
  if (!doc.objectKey.startsWith("sha256/") && basename) return basename;

  const hash = shortHash(doc.sourceDocHash ?? doc.objectKey, 10);
  const ext = doc.kind.toLowerCase();
  return `Source-${hash}.${ext}`;
}

function shortHash(value: string, size = 8): string {
  const cleaned = value.replace("sha256/", "").replace(/\.[a-z0-9]+$/i, "");
  return cleaned.slice(0, size);
}

function uploadedLabel(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();
  if (sameDay) {
    return `Today · ${date.toLocaleTimeString("en-AU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })}`;
  }
  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`h-9 rounded-full px-4 border items-center justify-center ${
        active ? "bg-primary border-primary" : "bg-card border-border"
      }`}
    >
      <Text className={`text-sm font-semibold ${active ? "text-primary-foreground" : "text-foreground"}`}>
        {label} · {count}
      </Text>
    </Pressable>
  );
}

function StatusPill({
  state,
  factReview,
}: {
  state: RowState;
  factReview?: SourceDocFactReview;
}) {
  const usageLabel = formatLlmUsageLabel(factReview);

  if (state === "converted") {
    return (
      <Box className="gap-1">
        <Box className="self-start rounded-full bg-[#EAF5EA] px-2.5 py-1">
          <Text className="text-xs font-semibold text-[#1f7a45]">
            Facts approved
          </Text>
        </Box>
        {usageLabel ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {usageLabel}
          </Text>
        ) : null}
      </Box>
    );
  }
  if (state === "processing") {
    const label =
      factReview?.status === "extracting_facts"
        ? factReview.expectedPages > 0
          ? `Extracting facts (${Math.min(
              factReview.extractedPages,
              factReview.expectedPages
            )}/${factReview.expectedPages})`
          : "Extracting facts"
        : "Converting";
    return (
      <Box className="gap-1">
        <Box className="self-start rounded-full bg-[#F4EFE1] px-2.5 py-1">
          <Text className="text-xs font-semibold text-[#8A5B12]">{label}</Text>
        </Box>
        {usageLabel ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {usageLabel}
          </Text>
        ) : null}
      </Box>
    );
  }
  const label =
    factReview?.status === "extracting_facts" && !factReview.llmConfigured
      ? "Extraction blocked (LLM key missing)"
      : factReview?.status === "needs_review"
      ? `Needs fact review${factReview.facts.pendingCandidates > 0 ? ` (${factReview.facts.pendingCandidates})` : ""}`
      : "Conversion failed";
  return (
    <Box className="gap-1">
      <Box className="self-start rounded-full bg-[#FAE9E5] px-2.5 py-1">
        <Text className="text-xs font-semibold text-[#B3362B]">{label}</Text>
      </Box>
      {usageLabel ? (
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {usageLabel}
        </Text>
      ) : null}
    </Box>
  );
}

function formatLlmUsageLabel(factReview?: SourceDocFactReview): string | null {
  if (!factReview) return null;
  if (!factReview.llmConfigured && factReview.status === "extracting_facts") {
    return "OPENROUTER_API_KEY is not configured";
  }
  if (!factReview.llmUsage.tracked) return "LLM usage not recorded yet";
  if (factReview.llmUsage.calls === 0) return "LLM calls: 0 (cache hit)";
  return `LLM: ${factReview.llmUsage.calls} call(s) · $${factReview.llmUsage.costUsd.toFixed(4)}`;
}

function RunPills({
  runIds,
  runNameById,
}: {
  runIds: Id<"runs">[];
  runNameById: Map<string, string>;
}) {
  if (runIds.length === 0) {
    return <Text className="text-sm text-muted-foreground">Not used in courses</Text>;
  }

  const first = runIds[0]!;
  const firstName = runNameById.get(String(first)) ?? `Course ${String(first).slice(0, 8)}`;
  const extra = runIds.length - 1;

  return (
    <Box className="flex-row items-center gap-1.5 flex-wrap">
      <Box className="rounded-full border border-border bg-card px-2 py-0.5">
        <Text className="text-xs font-semibold" numberOfLines={1}>
          {firstName}
        </Text>
      </Box>
      {extra > 0 ? (
        <Box className="rounded-full border border-border bg-card px-2 py-0.5">
          <Text className="text-xs font-semibold">+{extra}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
