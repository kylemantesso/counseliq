"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Box,
  Button,
  ButtonText,
  StatusBadge,
  SurfaceCard,
  Text,
} from "@counseliq/ui";
import { AdminGuard } from "../components/admin-guard";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

type TaskKey =
  | "extract-page"
  | "merge-inventory"
  | "compile-structure"
  | "author-unit"
  | "judge-course"
  | "tag-asset"
  | "outline-course";

type RoutingModel = {
  id: string;
  label: string;
  provider: string;
  supportsVision: boolean;
};

type RoutingTask = {
  task: TaskKey;
  label: string;
  description: string;
  requiresVision: boolean;
  configuredModel: string | null;
  effectiveModel: string;
  source: "config" | "env" | "default";
  envVar: string;
};

type RoutingResponse = {
  updatedAt: number | null;
  models: RoutingModel[];
  tasks: RoutingTask[];
  selectedModels: Record<TaskKey, string>;
};

type DraftRouting = Record<TaskKey, string>;

const EMPTY_DRAFT: DraftRouting = {
  "extract-page": "",
  "merge-inventory": "",
  "compile-structure": "",
  "author-unit": "",
  "judge-course": "",
  "tag-asset": "",
  "outline-course": "",
};

export function AdminModelRoutingScreen() {
  return (
    <AdminGuard>
      <AdminModelRoutingContent />
    </AdminGuard>
  );
}

function AdminModelRoutingContent() {
  const routingData = useQuery(
    (api as any).pipeline.queries.adminGetLlmModelRouting,
    {}
  ) as RoutingResponse | undefined;
  const saveRouting = useMutation((api as any).pipeline.queries.adminSetLlmModelRouting);

  const [draft, setDraft] = useState<DraftRouting>(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!routingData || dirty) return;
    setDraft(routingData.selectedModels);
  }, [routingData, dirty]);

  const tasks = routingData?.tasks ?? [];
  const hasMissingSelection = tasks.some((task) => !draft[task.task]);
  const isDirty = tasks.some((task) => draft[task.task] !== task.effectiveModel);

  const modelOptionsByTask = useMemo(() => {
    const models = routingData?.models ?? [];
    const byTask = new Map<TaskKey, RoutingModel[]>();
    for (const task of tasks) {
      byTask.set(
        task.task,
        task.requiresVision ? models.filter((model) => model.supportsVision) : models
      );
    }
    return byTask;
  }, [routingData?.models, tasks]);

  async function handleSave() {
    if (!routingData) return;
    if (hasMissingSelection) {
      setError("Choose a model for every task before saving.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveRouting({
        models: {
          "extract-page": draft["extract-page"],
          "merge-inventory": draft["merge-inventory"],
          "compile-structure": draft["compile-structure"],
          "author-unit": draft["author-unit"],
          "judge-course": draft["judge-course"],
          "tag-asset": draft["tag-asset"],
          "outline-course": draft["outline-course"],
        },
      });
      setDirty(false);
      setNotice("Model routing saved.");
    } catch (saveError) {
      setError(getUserFacingErrorMessage(saveError, "Could not save model routing."));
    } finally {
      setBusy(false);
    }
  }

  function resetDraft() {
    if (!routingData) return;
    setDraft(routingData.selectedModels);
    setDirty(false);
    setError(null);
    setNotice(null);
  }

  return (
    <AdminWorkspaceFrame
      activeNav="model-routing"
      title="Model routing"
      description="Choose which OpenRouter model powers each pipeline task."
      topbarTrail={["Workspace", "Operations", "Model routing"]}
    >
      <Box className="gap-4">
        <SurfaceCard
          title="Routing precedence"
          subtitle="Selection priority is admin config, then deployment env override, then code default."
        >
          <Text className="text-sm text-muted-foreground">
            Save once to lock your preferred models. Vision tasks only allow models with image input support.
          </Text>
        </SurfaceCard>

        {!routingData ? (
          <SurfaceCard>
            <Text className="text-muted-foreground">Loading model routing...</Text>
          </SurfaceCard>
        ) : (
          <Box className="gap-4">
            {tasks.map((task) => (
              <SurfaceCard key={task.task} title={task.label} subtitle={task.description}>
                <Box className="gap-2">
                  <Box className="flex-row flex-wrap items-center gap-2">
                    <StatusBadge
                      label={task.requiresVision ? "Vision task" : "Text task"}
                      tone={task.requiresVision ? "warning" : "accent"}
                    />
                    <StatusBadge
                      label={sourceLabel(task.source)}
                      tone={sourceTone(task.source)}
                    />
                  </Box>
                  <Text className="text-xs text-muted-foreground">
                    Effective now: {task.effectiveModel}
                    {task.source === "env"
                      ? ` (from ${task.envVar})`
                      : task.source === "default"
                        ? " (code default)"
                        : ""}
                  </Text>
                  <select
                    value={draft[task.task] || task.effectiveModel}
                    onChange={(event) => {
                      const modelId = event.target.value;
                      setDraft((current) => ({ ...current, [task.task]: modelId }));
                      setDirty(true);
                      setError(null);
                      setNotice(null);
                    }}
                    style={{
                      border: "1px solid #dddacd",
                      borderRadius: 10,
                      padding: "9px 12px",
                      background: "#fff",
                      fontSize: 14,
                      fontWeight: 500,
                      maxWidth: 520,
                    }}
                  >
                    {(modelOptionsByTask.get(task.task) ?? []).map((model) => (
                      <option key={`${task.task}-${model.id}`} value={model.id}>
                        {model.label} ({model.provider})
                      </option>
                    ))}
                  </select>
                </Box>
              </SurfaceCard>
            ))}

            <Box className="flex-row items-center gap-2">
              <Button variant="outline" onPress={resetDraft} isDisabled={!isDirty || busy}>
                <ButtonText>Reset</ButtonText>
              </Button>
              <Button onPress={handleSave} isDisabled={!isDirty || hasMissingSelection || busy}>
                <ButtonText>{busy ? "Saving..." : "Save model routing"}</ButtonText>
              </Button>
              {routingData.updatedAt ? (
                <Text className="text-xs text-muted-foreground">
                  Last updated {new Date(routingData.updatedAt).toLocaleString()}
                </Text>
              ) : null}
            </Box>
            {notice ? <Text className="text-sm text-[#1f7a45]">{notice}</Text> : null}
            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
          </Box>
        )}
      </Box>
    </AdminWorkspaceFrame>
  );
}

function sourceLabel(source: RoutingTask["source"]): string {
  if (source === "config") return "Admin override";
  if (source === "env") return "Env override";
  return "Default";
}

function sourceTone(
  source: RoutingTask["source"]
): "neutral" | "warning" | "success" {
  if (source === "config") return "success";
  if (source === "env") return "warning";
  return "neutral";
}
