"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  Input,
  InputField,
  ScrollView,
  Text,
} from "@counseliq/ui";
import { Image } from "react-native";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { Screen } from "../components/screen";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

export function AdminGateOneReviewScreen() {
  return (
    <AdminGuard>
      <AdminGateOneReviewContent />
    </AdminGuard>
  );
}

interface FlaggedFactPayload {
  fact: {
    statement: string;
    claimClass: string;
    sourceLabel?: string;
    year?: number;
    flagged: boolean;
    flagReason?: string;
  };
  provenance: string[];
  thumbKey?: string;
  pageN?: number;
}

function AdminGateOneReviewContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const runId = params?.id as Id<"runs"> | undefined;
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  const runResult = useQuery(
    api.pipeline.queries.getRun,
    runId ? { runId } : "skip"
  );
  const items = useQuery(
    api.pipeline.reviewItems.getRunReviewItems,
    runId ? { runId, gate: 1 } : "skip"
  );
  const decideGate = useMutation(api.pipeline.runs.adminDecideGate);
  const resolveBulk = useMutation(
    api.pipeline.reviewItems.adminResolveReviewItemsBulk
  );
  const presignBatch = useAction(api.pipeline.objectStore.adminPresignGetBatch);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (!items) return;
    const keys = [
      ...new Set(
        items
          .map((item) => (item.payload as FlaggedFactPayload).thumbKey)
          .filter((key): key is string => key !== undefined)
      ),
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
        // Thumbnails are optional; review works without them.
      });
    return () => {
      cancelled = true;
    };
  }, [items, presignBatch]);

  const run = runResult?.run;
  const pending = useMemo(
    () => (items ?? []).filter((item) => item.status === "pending"),
    [items]
  );
  const total = items?.length ?? 0;
  const resolved = total - pending.length;
  const atGate = run?.state === "GATE_1_KNOWLEDGE_REVIEW";

  const onDecide = async (decision: "approve" | "reject") => {
    if (!runId) return;
    setError(null);
    setDeciding(true);
    try {
      await decideGate({ runId, gate: 1, decision });
    } catch (err) {
      setError(
        getUserFacingErrorMessage(err, "Gate decision failed. Try again.")
      );
    } finally {
      setDeciding(false);
    }
  };

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center">
        <Heading size="md">Gate 1 — knowledge review</Heading>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <ButtonText>Back</ButtonText>
        </Button>
      </Box>
      <ScrollView className="flex-1 w-full">
        <Box className="flex-col gap-4 p-6">
          {runResult === undefined || items === undefined ? (
            <Text>Loading...</Text>
          ) : !run ? (
            <Text className="text-muted-foreground">Run not found.</Text>
          ) : (
            <>
              <Box className="bg-card border border-border rounded-xl p-4 gap-2">
                <Text className="font-semibold">
                  {resolved}/{total} flagged facts resolved · run state:{" "}
                  {run.state}
                </Text>
                {error ? (
                  <Text className="text-destructive text-sm">{error}</Text>
                ) : null}
                <Box className="flex-row gap-2">
                  <Button
                    size="sm"
                    onPress={() => onDecide("approve")}
                    disabled={!atGate || pending.length > 0 || deciding}
                  >
                    <ButtonText>
                      {pending.length > 0
                        ? `Resolve ${pending.length} item(s) first`
                        : "Approve gate 1"}
                    </ButtonText>
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onPress={() => onDecide("reject")}
                    disabled={!atGate || deciding}
                  >
                    <ButtonText>Reject run</ButtonText>
                  </Button>
                </Box>
                {!atGate ? (
                  <Text className="text-muted-foreground text-sm">
                    The run is not waiting at gate 1.
                  </Text>
                ) : null}
                {atGate && pending.length > 0 ? (
                  <Box className="flex-row gap-2 items-center flex-wrap pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() => {
                        setSelectedIds((prev) => {
                          const allSelected = pending.every((item) =>
                            prev.has(item._id)
                          );
                          if (allSelected) return new Set();
                          return new Set(pending.map((item) => item._id));
                        });
                      }}
                    >
                      <ButtonText>
                        {pending.every((item) => selectedIds.has(item._id))
                          ? "Clear selection"
                          : `Select all pending (${pending.length})`}
                      </ButtonText>
                    </Button>
                    {selectedIds.size > 0 ? (
                      <>
                        <Text className="text-sm font-semibold">
                          {selectedIds.size} selected:
                        </Text>
                        <Button
                          size="sm"
                          disabled={bulkBusy}
                          onPress={() =>
                            void (async () => {
                              setBulkBusy(true);
                              setError(null);
                              try {
                                await resolveBulk({
                                  reviewItemIds: [
                                    ...selectedIds,
                                  ] as Id<"reviewItems">[],
                                  resolution: "approve_without_source",
                                });
                                setSelectedIds(new Set());
                              } catch (err) {
                                setError(
                                  getUserFacingErrorMessage(
                                    err,
                                    "Bulk approve failed. Try again."
                                  )
                                );
                              } finally {
                                setBulkBusy(false);
                              }
                            })()
                          }
                        >
                          <ButtonText>Approve without source</ButtonText>
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={bulkBusy}
                          onPress={() =>
                            void (async () => {
                              setBulkBusy(true);
                              setError(null);
                              try {
                                await resolveBulk({
                                  reviewItemIds: [
                                    ...selectedIds,
                                  ] as Id<"reviewItems">[],
                                  resolution: "exclude",
                                });
                                setSelectedIds(new Set());
                              } catch (err) {
                                setError(
                                  getUserFacingErrorMessage(
                                    err,
                                    "Bulk exclude failed. Try again."
                                  )
                                );
                              } finally {
                                setBulkBusy(false);
                              }
                            })()
                          }
                        >
                          <ButtonText>Exclude</ButtonText>
                        </Button>
                        <Text className="text-xs text-muted-foreground">
                          Approving without source keeps the fact
                          unattributed — source-less statistics cannot ride
                          stat cards.
                        </Text>
                      </>
                    ) : null}
                  </Box>
                ) : null}
              </Box>

              {items.length === 0 ? (
                <Text className="text-muted-foreground">
                  No flagged facts — nothing to review at this gate.
                </Text>
              ) : (
                items.map((item) => (
                  <ReviewItemCard
                    key={item._id}
                    item={item}
                    thumbUrl={
                      (item.payload as FlaggedFactPayload).thumbKey
                        ? urls[
                            (item.payload as FlaggedFactPayload)
                              .thumbKey as string
                          ]
                        : undefined
                    }
                    selected={selectedIds.has(item._id)}
                    onToggleSelect={() =>
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(item._id)) next.delete(item._id);
                        else next.add(item._id);
                        return next;
                      })
                    }
                    onError={setError}
                  />
                ))
              )}
            </>
          )}
        </Box>
      </ScrollView>
    </Screen>
  );
}

function ReviewItemCard({
  item,
  thumbUrl,
  selected,
  onToggleSelect,
  onError,
}: {
  item: Doc<"reviewItems">;
  thumbUrl?: string;
  selected: boolean;
  onToggleSelect: () => void;
  onError: (message: string | null) => void;
}) {
  const payload = item.payload as FlaggedFactPayload;
  const resolveItem = useMutation(api.pipeline.reviewItems.adminResolveReviewItem);
  const [sourceLabel, setSourceLabel] = useState(payload.fact.sourceLabel ?? "");
  const [year, setYear] = useState(
    payload.fact.year !== undefined ? String(payload.fact.year) : ""
  );
  const [busy, setBusy] = useState(false);

  const resolve = async (
    resolution: "approve" | "approve_without_source" | "exclude"
  ) => {
    onError(null);
    setBusy(true);
    try {
      await resolveItem({
        reviewItemId: item._id,
        resolution,
        ...(resolution === "approve"
          ? { sourceLabel: sourceLabel.trim(), year: Number(year) }
          : {}),
      });
    } catch (err) {
      onError(
        getUserFacingErrorMessage(
          err,
          "Could not resolve the item. Supply a source and year, then retry."
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const pending = item.status === "pending";
  const yearValid = /^\d{4}$/.test(year.trim());

  return (
    <Box
      className={`bg-card border rounded-xl p-4 gap-3 ${
        pending ? "border-destructive" : "border-border opacity-70"
      }`}
    >
      <Box className="flex-row gap-4">
        {pending ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            style={{ width: 18, height: 18, alignSelf: "flex-start", marginTop: 2 }}
          />
        ) : null}
        {thumbUrl ? (
          <Image
            source={{ uri: thumbUrl }}
            resizeMode="contain"
            style={{
              width: 160,
              aspectRatio: 4 / 3,
              backgroundColor: "#f4f4f5",
              borderRadius: 8,
            }}
          />
        ) : null}
        <Box className="flex-1 gap-1">
          <Text className="text-sm">{payload.fact.statement}</Text>
          <Text className="text-xs text-muted-foreground">
            {payload.fact.claimClass.replace("_", " ")}
            {payload.pageN !== undefined ? ` · page ${payload.pageN}` : ""}
            {payload.fact.flagReason ? ` · ⚑ ${payload.fact.flagReason}` : ""}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {payload.provenance.join(", ")}
          </Text>
          {!pending ? (
            <Text className="text-xs font-semibold">
              {item.status === "approved"
                ? `Approved with source: ${payload.fact.sourceLabel ?? ""} (${payload.fact.year ?? ""})`
                : "Excluded from the inventory"}
              {item.reviewer ? ` — ${item.reviewer}` : ""}
            </Text>
          ) : null}
        </Box>
      </Box>

      {pending ? (
        <Box className="flex-row flex-wrap gap-2 items-center">
          <Box className="flex-1 min-w-40">
            <Input>
              <InputField
                placeholder="Source label (e.g. QILT GOS 2024)"
                value={sourceLabel}
                onChangeText={setSourceLabel}
              />
            </Input>
          </Box>
          <Box className="w-24">
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
            onPress={() => resolve("approve")}
            disabled={busy || sourceLabel.trim() === "" || !yearValid}
          >
            <ButtonText>Approve with source</ButtonText>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onPress={() => resolve("approve_without_source")}
            disabled={busy}
          >
            <ButtonText>Approve without source</ButtonText>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onPress={() => resolve("exclude")}
            disabled={busy}
          >
            <ButtonText>Exclude</ButtonText>
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
