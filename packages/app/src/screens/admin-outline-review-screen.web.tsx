"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "solito/navigation";
import { Box, Button, ButtonText, Heading, Text } from "@counseliq/ui";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { Screen } from "../components/screen";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

/**
 * Outline review (M6.5) — the editable course outline between gate 1 and
 * compilation. The operator shapes the course here (title, learning
 * outcomes, modules/units, media suggestions) before any authoring spend;
 * Approve starts compilation, Regenerate re-runs the outline pass with
 * feedback (replacing manual edits — the UI warns).
 */

interface EditableUnit {
  unitId: string;
  conceptKey: string;
  conceptTag: string;
  title: string;
  secondsBudget: number;
  mediaAssetIds: string[];
}

interface EditableModule {
  moduleId: string;
  title: string;
  rationale: string;
  units: EditableUnit[];
}

interface EditableOutline {
  courseTitle: string;
  learningOutcomes: string[];
  modules: EditableModule[];
}

export function AdminOutlineReviewScreen() {
  return (
    <AdminGuard>
      <OutlineReviewContent />
    </AdminGuard>
  );
}

function toEditable(outline: {
  courseTitle: string;
  learningOutcomes: string[];
  modules: unknown;
}): EditableOutline {
  const modules = outline.modules as Array<{
    moduleId: string;
    title: string;
    rationale?: string | null;
    units: Array<{
      unitId: string;
      conceptKey: string;
      conceptTag: string;
      title: string;
      secondsBudget: number;
      mediaAssetIds?: string[] | null;
    }>;
  }>;
  return {
    courseTitle: outline.courseTitle,
    learningOutcomes: [...outline.learningOutcomes],
    modules: modules.map((module) => ({
      moduleId: module.moduleId,
      title: module.title,
      rationale: module.rationale ?? "",
      units: module.units.map((unit) => ({
        unitId: unit.unitId,
        conceptKey: unit.conceptKey,
        conceptTag: unit.conceptTag,
        title: unit.title,
        secondsBudget: unit.secondsBudget,
        mediaAssetIds: unit.mediaAssetIds ?? [],
      })),
    })),
  };
}

/** Wire shape for adminUpdateOutline (empty strings/arrays → omitted). */
function toWireModules(modules: EditableModule[]) {
  return modules.map((module) => ({
    moduleId: module.moduleId,
    title: module.title,
    ...(module.rationale.trim() ? { rationale: module.rationale.trim() } : {}),
    units: module.units.map((unit) => ({
      unitId: unit.unitId,
      conceptKey: unit.conceptKey,
      conceptTag: unit.conceptTag,
      title: unit.title,
      secondsBudget: unit.secondsBudget,
      ...(unit.mediaAssetIds.length > 0
        ? { mediaAssetIds: unit.mediaAssetIds }
        : {}),
    })),
  }));
}

/** Next free mu-<n> across the outline. */
function nextUnitId(outline: EditableOutline): string {
  let max = 100;
  for (const module of outline.modules) {
    for (const unit of module.units) {
      const match = unit.unitId.match(/^mu-(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `mu-${max + 1}`;
}

function OutlineReviewContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const runId = params?.id as Id<"runs"> | undefined;

  const view = useQuery(
    api.pipeline.outlineReview.adminGetOutline,
    runId ? { runId } : "skip"
  );
  const updateOutline = useMutation(api.pipeline.outlineReview.adminUpdateOutline);
  const approveOutline = useMutation(api.pipeline.outlineReview.adminApproveOutline);
  const regenerateOutline = useMutation(
    api.pipeline.outlineReview.adminRegenerateOutline
  );

  const [draft, setDraft] = useState<EditableOutline | null>(null);
  const [dirty, setDirty] = useState(false);
  const [regenNotes, setRegenNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adopt the server outline whenever we have no unsaved local edits (a
  // regenerate lands a fresh draft reactively).
  const serverOutline = view?.outline ?? null;
  useEffect(() => {
    if (!serverOutline) return;
    if (!dirty) setDraft(toEditable(serverOutline));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOutline?.generatedAt, serverOutline?.editedAt]);

  if (!runId) return null;
  // Narrowed copy for the closures below (TS can't narrow captures).
  const rid: Id<"runs"> = runId;
  const editable = view?.runState === "OUTLINE_REVIEW";

  function edit(mutator: (next: EditableOutline) => void) {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
    setDirty(true);
  }

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(getUserFacingErrorMessage(actionError, `${label} failed. Try again.`));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    await run("Save", async () => {
      await updateOutline({
        runId: rid,
        courseTitle: draft.courseTitle,
        learningOutcomes: draft.learningOutcomes.filter((o) => o.trim() !== ""),
        modules: toWireModules(draft.modules),
      });
      setDirty(false);
    });
  }

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center flex-wrap gap-2">
        <Box>
          <Heading size="md">Course outline</Heading>
          <Text className="text-muted-foreground text-sm">
            {view?.runState === "OUTLINING"
              ? "Outline is being generated…"
              : editable
                ? "Edit freely — nothing is authored until you approve."
                : `Run state: ${view?.runState ?? "…"}`}
          </Text>
        </Box>
        <Box className="flex-row gap-2 items-center">
          <Button variant="outline" size="sm" onPress={() => router.push(`/admin/runs/${runId}`)}>
            <ButtonText>Run detail</ButtonText>
          </Button>
          {editable ? (
            <>
              <Button size="sm" variant="outline" disabled={!dirty || busy} onPress={() => void save()}>
                <ButtonText>{dirty ? "Save edits" : "Saved"}</ButtonText>
              </Button>
              <Button
                size="sm"
                disabled={busy || dirty}
                onPress={() =>
                  void run("Approve", async () => {
                    await approveOutline({ runId: rid });
                    router.push(`/admin/runs/${rid}`);
                  })
                }
              >
                <ButtonText>{dirty ? "Save before approving" : "Approve outline → compile"}</ButtonText>
              </Button>
            </>
          ) : null}
        </Box>
      </Box>

      <Box className="flex-1 p-6 gap-4" style={{ overflow: "auto" } as never}>
        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
        {view === undefined ? (
          <Text>Loading…</Text>
        ) : !draft ? (
          <Text className="text-muted-foreground">
            {view.runState === "OUTLINING"
              ? "The outline pass is running — this page updates automatically."
              : "No outline yet for this run."}
          </Text>
        ) : (
          <>
            {view.brief ? (
              <Box className="bg-card border border-border rounded-xl p-4 gap-1">
                <Text className="text-xs font-semibold uppercase text-muted-foreground">
                  Operator brief (directs this outline)
                </Text>
                <Text className="text-sm">{view.brief}</Text>
              </Box>
            ) : null}

            <Box className="bg-card border border-border rounded-xl p-4 gap-2">
              <Text className="text-xs font-semibold uppercase text-muted-foreground">
                Course title
              </Text>
              <input
                value={draft.courseTitle}
                disabled={!editable}
                onChange={(e) => edit((next) => void (next.courseTitle = e.target.value))}
                style={{ padding: 8, borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 16, fontWeight: 600 }}
              />
              <Text className="text-xs font-semibold uppercase text-muted-foreground mt-2">
                Learning outcomes ({draft.learningOutcomes.length}; 3–7 required)
              </Text>
              {draft.learningOutcomes.map((outcome, index) => (
                <Box key={index} className="flex-row gap-2 items-center">
                  <input
                    value={outcome}
                    disabled={!editable}
                    maxLength={160}
                    onChange={(e) =>
                      edit((next) => void (next.learningOutcomes[index] = e.target.value))
                    }
                    style={{ flex: 1, padding: 6, borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13, width: "100%" }}
                  />
                  {editable ? (
                    <button
                      onClick={() => edit((next) => void next.learningOutcomes.splice(index, 1))}
                      style={ghostButton}
                      title="Remove outcome"
                    >
                      ×
                    </button>
                  ) : null}
                </Box>
              ))}
              {editable && draft.learningOutcomes.length < 7 ? (
                <button
                  onClick={() => edit((next) => next.learningOutcomes.push(""))}
                  style={{ ...ghostButton, alignSelf: "flex-start", fontSize: 12 }}
                >
                  + add outcome
                </button>
              ) : null}
            </Box>

            {draft.modules.map((module, mIndex) => (
              <Box key={module.moduleId} className="bg-card border border-border rounded-xl p-4 gap-2">
                <Box className="flex-row gap-2 items-center">
                  <Text className="text-xs font-mono text-muted-foreground">{module.moduleId}</Text>
                  <input
                    value={module.title}
                    disabled={!editable}
                    onChange={(e) =>
                      edit((next) => void (next.modules[mIndex].title = e.target.value))
                    }
                    style={{ flex: 1, padding: 6, borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 15, fontWeight: 600 }}
                  />
                  {editable ? (
                    <>
                      <button style={ghostButton} title="Move module up" disabled={mIndex === 0}
                        onClick={() => edit((next) => { const [m] = next.modules.splice(mIndex, 1); next.modules.splice(mIndex - 1, 0, m); })}>↑</button>
                      <button style={ghostButton} title="Move module down" disabled={mIndex === draft.modules.length - 1}
                        onClick={() => edit((next) => { const [m] = next.modules.splice(mIndex, 1); next.modules.splice(mIndex + 1, 0, m); })}>↓</button>
                      <button style={ghostButton} title="Delete module (and its units)"
                        onClick={() => edit((next) => void next.modules.splice(mIndex, 1))}>🗑</button>
                    </>
                  ) : null}
                </Box>
                <input
                  value={module.rationale}
                  disabled={!editable}
                  placeholder="Module rationale (one line)"
                  onChange={(e) =>
                    edit((next) => void (next.modules[mIndex].rationale = e.target.value))
                  }
                  style={{ padding: 6, borderRadius: 8, border: "1px solid #ececee", fontSize: 12, color: "#52525b" }}
                />

                {module.units.map((unit, uIndex) => (
                  <div key={unit.unitId} style={{ border: "1px solid #ececee", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    <Box className="flex-row gap-2 items-center flex-wrap">
                      <Text className="text-xs font-mono text-muted-foreground">{unit.unitId}</Text>
                      <input
                        value={unit.title}
                        disabled={!editable}
                        onChange={(e) =>
                          edit((next) => void (next.modules[mIndex].units[uIndex].title = e.target.value))
                        }
                        style={{ flex: 1, minWidth: 220, padding: 5, borderRadius: 6, border: "1px solid #d4d4d8", fontSize: 13, fontWeight: 600 }}
                      />
                      <label style={{ fontSize: 11, color: "#71717a" }}>
                        budget{" "}
                        <input
                          type="number"
                          min={20}
                          max={90}
                          value={unit.secondsBudget}
                          disabled={!editable}
                          onChange={(e) =>
                            edit((next) => void (next.modules[mIndex].units[uIndex].secondsBudget = Number(e.target.value)))
                          }
                          style={{ width: 56, padding: 4, borderRadius: 6, border: "1px solid #d4d4d8" }}
                        />
                        s
                      </label>
                      {editable ? (
                        <>
                          <select
                            value={module.moduleId}
                            title="Move to module"
                            onChange={(e) =>
                              edit((next) => {
                                const target = next.modules.findIndex((m) => m.moduleId === e.target.value);
                                if (target === -1 || target === mIndex) return;
                                const [moved] = next.modules[mIndex].units.splice(uIndex, 1);
                                next.modules[target].units.push(moved);
                              })
                            }
                            style={{ padding: 4, borderRadius: 6, fontSize: 11 }}
                          >
                            {draft.modules.map((m) => (
                              <option key={m.moduleId} value={m.moduleId}>{m.title || m.moduleId}</option>
                            ))}
                          </select>
                          <button style={ghostButton} disabled={uIndex === 0} title="Move unit up"
                            onClick={() => edit((next) => { const units = next.modules[mIndex].units; const [u] = units.splice(uIndex, 1); units.splice(uIndex - 1, 0, u); })}>↑</button>
                          <button style={ghostButton} disabled={uIndex === module.units.length - 1} title="Move unit down"
                            onClick={() => edit((next) => { const units = next.modules[mIndex].units; const [u] = units.splice(uIndex, 1); units.splice(uIndex + 1, 0, u); })}>↓</button>
                          <button style={ghostButton} title="Delete unit"
                            onClick={() => edit((next) => void next.modules[mIndex].units.splice(uIndex, 1))}>🗑</button>
                        </>
                      ) : null}
                    </Box>
                    <Text className="text-xs text-muted-foreground">
                      concept: {unit.conceptKey} · tag: {unit.conceptTag}
                    </Text>
                    <Box className="flex-row gap-1 items-center flex-wrap">
                      {unit.mediaAssetIds.map((assetId) => (
                        <span key={assetId} style={{ fontSize: 10, background: "#f4f4f5", borderRadius: 999, padding: "2px 8px", display: "inline-flex", gap: 4, alignItems: "center" }}>
                          {view.suggestedAssets[assetId]?.caption ??
                            view.clearedAssets.find((a) => a.id === assetId)?.caption ??
                            assetId.slice(0, 10)}
                          {editable ? (
                            <button style={{ ...ghostButton, padding: 0, fontSize: 11 }}
                              onClick={() => edit((next) => { const ids = next.modules[mIndex].units[uIndex].mediaAssetIds; ids.splice(ids.indexOf(assetId), 1); })}>×</button>
                          ) : null}
                        </span>
                      ))}
                      {editable && view.clearedAssets.length > 0 ? (
                        <select
                          value=""
                          title="Suggest an asset for this unit"
                          onChange={(e) => {
                            const id = e.target.value;
                            if (!id) return;
                            edit((next) => {
                              const ids = next.modules[mIndex].units[uIndex].mediaAssetIds;
                              if (!ids.includes(id) && ids.length < 3) ids.push(id);
                            });
                          }}
                          style={{ padding: 3, borderRadius: 6, fontSize: 10, maxWidth: 180 }}
                        >
                          <option value="">+ suggest asset…</option>
                          {view.clearedAssets.map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              [{asset.kind}] {asset.caption ?? asset.id.slice(0, 12)}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </Box>
                  </div>
                ))}

                {editable && view.unusedConcepts.length > 0 ? (
                  <select
                    value=""
                    onChange={(e) => {
                      const key = e.target.value;
                      if (!key) return;
                      const concept = view.unusedConcepts.find((c) => c.key === key);
                      if (!concept) return;
                      edit((next) => {
                        next.modules[mIndex].units.push({
                          unitId: nextUnitId(next),
                          conceptKey: concept.key,
                          conceptTag: concept.key,
                          title: concept.title,
                          secondsBudget: 45,
                          mediaAssetIds: [],
                        });
                      });
                    }}
                    style={{ padding: 6, borderRadius: 8, fontSize: 12, alignSelf: "flex-start" }}
                  >
                    <option value="">+ add unit from an unused concept…</option>
                    {view.unusedConcepts.map((concept) => (
                      <option key={concept.key} value={concept.key}>
                        {concept.title} ({concept.key})
                      </option>
                    ))}
                  </select>
                ) : null}
              </Box>
            ))}

            {editable ? (
              <Box className="bg-card border border-border rounded-xl p-4 gap-2">
                <Text className="text-xs font-semibold uppercase text-muted-foreground">
                  Regenerate with feedback
                </Text>
                <Text className="text-xs text-destructive">
                  Regenerating REPLACES the current outline — manual edits are lost.
                </Text>
                <textarea
                  value={regenNotes}
                  onChange={(e) => setRegenNotes(e.target.value)}
                  placeholder="e.g. Merge the two evidence modules; drop anything about accommodation; add an outcome on placement requirements."
                  rows={3}
                  style={{ padding: 8, borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  disabled={busy || regenNotes.trim() === ""}
                  onPress={() =>
                    void run("Regenerate", async () => {
                      await regenerateOutline({ runId: rid, feedback: regenNotes.trim() });
                      setRegenNotes("");
                      setDirty(false);
                    })
                  }
                >
                  <ButtonText>Regenerate outline</ButtonText>
                </Button>
              </Box>
            ) : null}
          </>
        )}
      </Box>
    </Screen>
  );
}

const ghostButton: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#71717a",
  fontSize: 14,
  padding: 2,
};
