"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "solito/navigation";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";
import { formatModuleNumberLabel } from "../format/unit-labels";

/**
 * Outline review - the editable course blueprint between extraction and
 * compilation. The operator shapes the whole outline before authoring spend:
 * title, outcomes, modules, unit sequence, concepts, timing, and media hints.
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

interface ConceptOption {
  key: string;
  title: string;
  summary?: string;
}

interface ClearedAssetOption {
  id: string;
  kind: string;
  caption: string | null;
}

const COURSE_DETAILS_PANEL = "__course-details";

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

/** Wire shape for adminUpdateOutline (empty strings/arrays omitted). */
function toWireModules(modules: EditableModule[]) {
  return modules.map((module) => ({
    moduleId: module.moduleId.trim(),
    title: module.title.trim(),
    ...(module.rationale.trim() ? { rationale: module.rationale.trim() } : {}),
    units: module.units.map((unit) => ({
      unitId: unit.unitId.trim(),
      conceptKey: unit.conceptKey.trim(),
      conceptTag: unit.conceptTag.trim(),
      title: unit.title.trim(),
      secondsBudget: unit.secondsBudget,
      ...(unit.mediaAssetIds.length > 0
        ? { mediaAssetIds: unit.mediaAssetIds }
        : {}),
    })),
  }));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
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

function nextModuleId(outline: EditableOutline): string {
  let max = 0;
  for (const module of outline.modules) {
    const match = module.moduleId.match(/^m(\d+)-/i);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `m${max + 1}-new-module`;
}

function totalUnits(outline: EditableOutline): number {
  return outline.modules.reduce((sum, module) => sum + module.units.length, 0);
}

function outlineDurationSeconds(outline: EditableOutline): number {
  return outline.modules.reduce(
    (sum, module) =>
      sum + module.units.reduce((inner, unit) => inner + unit.secondsBudget, 0),
    0
  );
}

function buildConceptOptions(
  outline: EditableOutline | null,
  unusedConcepts: ConceptOption[]
): ConceptOption[] {
  const byKey = new Map<string, ConceptOption>();
  for (const concept of unusedConcepts) byKey.set(concept.key, concept);
  for (const module of outline?.modules ?? []) {
    for (const unit of module.units) {
      if (!byKey.has(unit.conceptKey)) {
        byKey.set(unit.conceptKey, {
          key: unit.conceptKey,
          title: unit.title || unit.conceptKey,
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title));
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

  const [draft, setDraft] = useState<EditableOutline | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);

  const serverOutline = view?.outline ?? null;
  useEffect(() => {
    if (!serverOutline) return;
    if (!dirty) {
      const next = toEditable(serverOutline);
      setDraft(next);
      setActiveModuleId((current) => current ?? next.modules[0]?.moduleId ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOutline?.generatedAt, serverOutline?.editedAt]);

  const conceptOptions = useMemo(
    () => buildConceptOptions(draft, view?.unusedConcepts ?? []),
    [draft, view?.unusedConcepts]
  );

  const stats = useMemo(() => {
    if (!draft) return { modules: 0, units: 0, minutes: 0, outcomes: 0 };
    return {
      modules: draft.modules.length,
      units: totalUnits(draft),
      minutes: Math.round(outlineDurationSeconds(draft) / 60),
      outcomes: draft.learningOutcomes.filter((outcome) => outcome.trim() !== "")
        .length,
    };
  }, [draft]);

  if (!runId) return null;
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
        courseTitle: draft.courseTitle.trim(),
        learningOutcomes: draft.learningOutcomes
          .map((outcome) => outcome.trim())
          .filter(Boolean),
        modules: toWireModules(draft.modules),
      });
      setDirty(false);
    });
  }

  function addModule() {
    if (!draft || conceptOptions.length === 0) return;
    const moduleId = nextModuleId(draft);
    const concept = conceptOptions[0];
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      next.modules.push({
        moduleId,
        title: "New module",
        rationale: "",
        units: [
          {
            unitId: nextUnitId(next),
            conceptKey: concept.key,
            conceptTag: slugify(concept.key) || concept.key,
            title: concept.title,
            secondsBudget: 45,
            mediaAssetIds: [],
          },
        ],
      });
      return next;
    });
    setDirty(true);
    setActiveModuleId(moduleId);
  }

  const showingCourseDetails = activeModuleId === COURSE_DETAILS_PANEL;
  const activeModuleIndex = draft && !showingCourseDetails
    ? Math.max(
        0,
        draft.modules.findIndex((module) => module.moduleId === activeModuleId)
      )
    : -1;
  const activeModule = draft && activeModuleIndex >= 0 ? draft.modules[activeModuleIndex] : null;

  return (
    <AdminWorkspaceFrame
      activeNav="runs"
      title="Outline studio"
      showPageHeader={false}
      contentClassName="flex-1 min-h-0 bg-[#f4f3ef] p-0"
    >
      <div className="flex min-h-full flex-col bg-[#f4f3ef] text-[#262420]">
        <div className="sticky top-0 z-20 border-b border-[#e6e2d9] bg-[#f4f3ef]/95 px-5 py-4 backdrop-blur md:px-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-[260px] flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="m-0 text-[22px] font-black leading-7 tracking-[-0.04em] text-[#151412]">
                  Outline studio
                </h1>
                {dirty ? <StudioStatusPill label="Unsaved changes" /> : null}
              </div>
              <p className="mt-1 m-0 text-[13px] leading-5 text-[#706b61]">
                Edit freely - nothing is authored until you approve. Shape the structure now; authoring is the expensive step.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <StudioHeaderButton label="Run detail" onClick={() => router.push(`/admin/runs/${runId}`)} />
              {editable ? (
                <>
                  <StudioHeaderButton
                    label="Save"
                    disabled={!dirty || busy}
                    onClick={() => void save()}
                  />
                  <button
                    type="button"
                    disabled={busy || dirty || !draft}
                    onClick={() =>
                      void run("Approve", async () => {
                        await approveOutline({ runId: rid });
                        router.push(`/admin/runs/${rid}`);
                      })
                    }
                    className="h-9 rounded-full bg-[#24221f] px-5 text-[13px] font-black text-white shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {dirty ? "Save before approve" : "Approve outline and compile"}
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {error ? (
            <div className="mt-3 rounded-2xl border border-[#dfb3aa] bg-[#fff2ef] px-4 py-3 text-sm font-semibold text-[#8b3d2f]">
              {error}
            </div>
          ) : null}
        </div>

        {view === undefined ? (
          <EmptyDocumentState title="Loading outline" body="Fetching the editable outline draft." />
        ) : !draft ? (
          <EmptyDocumentState
            title={view.runState === "OUTLINING" ? "Generating outline" : "No outline yet"}
            body={
              view.runState === "OUTLINING"
                ? "The outline pass is running. This page updates automatically when the draft is ready."
                : "This run does not have an outline draft yet."
            }
          />
        ) : (
          <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
            <OutlineMapPanel
              draft={draft}
              stats={stats}
              activeModuleId={showingCourseDetails ? null : activeModule?.moduleId ?? null}
              activeCourseDetails={showingCourseDetails}
              editable={editable}
              onSelectCourseDetails={() => setActiveModuleId(COURSE_DETAILS_PANEL)}
              onSelectModule={setActiveModuleId}
              onAddModule={addModule}
              canAddModule={conceptOptions.length > 0}
            />

            <main className="min-w-0 px-5 py-5 md:px-7 lg:overflow-auto">
              {showingCourseDetails ? (
                <CourseDetailsStudio
                  draft={draft}
                  editable={editable}
                  onEdit={edit}
                />
              ) : activeModule ? (
                <ActiveModuleStudio
                  module={activeModule}
                  moduleIndex={activeModuleIndex}
                  outline={draft}
                  editable={editable}
                  conceptOptions={conceptOptions}
                  clearedAssets={view.clearedAssets}
                  suggestedAssets={view.suggestedAssets}
                  onEdit={edit}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-[#d8d2c7] p-8 text-center text-sm font-semibold text-[#777166]">
                  No modules in this outline yet.
                </div>
              )}
            </main>
          </div>
        )}
      </div>
    </AdminWorkspaceFrame>
  );
}

function moduleDurationSeconds(module: EditableModule): number {
  return module.units.reduce((sum, unit) => sum + unit.secondsBudget, 0);
}

function formatRuntime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function moduleLabel(module: EditableModule, index: number): string {
  return formatModuleNumberLabel(module.moduleId, index);
}

function outlineUnitLabel(moduleIndex: number, unitIndex: number): string {
  return `${moduleIndex + 1}.${unitIndex + 1}`;
}

function StudioStatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#ead8ad] bg-[#f5ead2] px-3 py-1 text-[11px] font-black text-[#9b6d1e]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#bd8424]" />
      {label}
    </span>
  );
}

function StudioHeaderButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-9 rounded-full border border-[#ddd8cf] bg-white px-5 text-[13px] font-black text-[#302d28] shadow-sm transition hover:border-[#c9c1b5] hover:bg-[#fbfaf7] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {label}
    </button>
  );
}

function OutlineMapPanel({
  draft,
  stats,
  activeModuleId,
  activeCourseDetails,
  editable,
  onSelectCourseDetails,
  onSelectModule,
  onAddModule,
  canAddModule,
}: {
  draft: EditableOutline;
  stats: { modules: number; units: number; minutes: number; outcomes: number };
  activeModuleId: string | null;
  activeCourseDetails: boolean;
  editable: boolean;
  onSelectCourseDetails: () => void;
  onSelectModule: (moduleId: string) => void;
  onAddModule: () => void;
  canAddModule: boolean;
}) {
  return (
    <aside className="border-b border-[#e6e2d9] bg-[#f2f1ed] px-4 py-4 lg:border-b-0 lg:border-r lg:overflow-auto">
      <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#9b968d]">
        Outline map
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 border-b border-[#e6e2d9] pb-4">
        <MapStat label="modules" value={String(stats.modules)} />
        <MapStat label="units" value={String(stats.units)} />
        <MapStat label="runtime" value={formatRuntime(outlineDurationSeconds(draft))} />
      </div>

      <button
        type="button"
        onClick={onSelectCourseDetails}
        className={`mt-4 flex w-full items-center gap-3 rounded-2xl border px-2.5 py-2.5 text-left transition ${
          activeCourseDetails
            ? "border-[#22201d] bg-white shadow-sm"
            : "border-transparent hover:bg-white/60"
        }`}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e5e1d8] text-[#8c8579]">
          <span className="h-3.5 w-3.5 rounded-sm border-2 border-current" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-black text-[#312f2a]">Course details</div>
          <div className="mt-0.5 text-[11px] font-semibold text-[#918b80]">
            Title · {stats.outcomes} outcomes
          </div>
        </div>
      </button>

      <div className="mt-4 border-b border-[#e6e2d9]" />

      <div className="mt-4">
        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.24em] text-[#9b968d]">
          Modules
        </div>
        <div className="space-y-2">
          {draft.modules.map((module, moduleIndex) => {
            const active = module.moduleId === activeModuleId;
            return (
              <button
                key={`${module.moduleId}-${moduleIndex}`}
                type="button"
                onClick={() => onSelectModule(module.moduleId)}
                className={`w-full rounded-2xl px-3 py-2.5 text-left transition ${
                  active
                    ? "border border-[#22201d] bg-white shadow-sm"
                    : "border border-transparent bg-transparent hover:bg-white/60"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-mono text-[11px] font-black text-[#8f897f]">
                      {moduleLabel(module, moduleIndex)}
                    </span>
                    <span className="truncate text-[13px] font-black text-[#302d28]">
                      {module.title || "Untitled module"}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] font-bold text-[#a09a90]">
                    {formatRuntime(moduleDurationSeconds(module))}
                  </span>
                </div>
                {active ? (
                  <div className="ml-3 mt-3 space-y-2 border-l border-[#dfdbd2] pl-4">
                    {module.units.map((unit, unitIndex) => (
                      <div key={unit.unitId} className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 font-mono text-[10px] font-black text-[#b2aa9e]">
                          {outlineUnitLabel(moduleIndex, unitIndex)}
                        </span>
                        <span className="truncate text-[11px] font-medium text-[#6f695f]">
                          {unit.title || "Untitled unit"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
        {editable ? (
          <button
            type="button"
            disabled={!canAddModule}
            onClick={onAddModule}
            className="mt-3 w-full rounded-2xl border border-dashed border-[#d5cec2] px-3 py-2.5 text-left text-[13px] font-black text-[#80786d] transition hover:border-[#bcb3a5] hover:bg-white/55 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Add module
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function MapStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[18px] font-black leading-none tracking-[-0.04em] text-[#25231f]">
        {value}
      </div>
      <div className="mt-1 text-[10px] font-semibold text-[#8e877d]">{label}</div>
    </div>
  );
}

function CourseDetailsStudio({
  draft,
  editable,
  onEdit,
}: {
  draft: EditableOutline;
  editable: boolean;
  onEdit: (mutator: (next: EditableOutline) => void) => void;
}) {
  return (
    <section className="mx-auto max-w-[1080px]">
      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-[#9a9387]">
          <span className="rounded bg-[#ece8df] px-2 py-1 font-mono text-[10px] font-black text-[#8f877a]">
            course
          </span>
          <span>details</span>
        </div>
        <textarea
          value={draft.courseTitle}
          disabled={!editable}
          rows={2}
          aria-label="Course title"
          onChange={(event) =>
            onEdit((next) => {
              next.courseTitle = event.target.value;
            })
          }
          className="mt-3 block w-full resize-none border-0 bg-transparent p-0 text-[30px] font-black leading-9 tracking-[-0.05em] text-[#191816] outline-none disabled:opacity-100 md:text-[38px] md:leading-[42px]"
        />
        <p className="m-0 mt-2 text-[13px] leading-5 text-[#6e685e]">
          Edit the course title and learning outcomes before approving the outline.
        </p>
      </div>

      <div className="space-y-3">
        {draft.learningOutcomes.map((outcome, index) => (
          <article key={index} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 rounded-2xl border border-[#e2ded5] bg-white px-4 py-3 shadow-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#24221f] text-[12px] font-black text-white">
              {index + 1}
            </div>
            <div className="min-w-0">
              <input
                value={outcome}
                disabled={!editable}
                maxLength={160}
                aria-label={`Learning outcome ${index + 1}`}
                onChange={(event) =>
                  onEdit((next) => {
                    next.learningOutcomes[index] = event.target.value;
                  })
                }
                className="block w-full border-0 bg-transparent p-0 text-[14px] font-black leading-5 text-[#25231f] outline-none disabled:opacity-100"
              />
              <div className="mt-1 font-mono text-[10.5px] font-semibold text-[#8b8377]">
                {outcome.length}/160 characters
              </div>
            </div>
            {editable ? (
              <StudioIconButton
                label="Remove outcome"
                icon="×"
                disabled={draft.learningOutcomes.length <= 3}
                onClick={() => onEdit((next) => next.learningOutcomes.splice(index, 1))}
              />
            ) : null}
          </article>
        ))}
      </div>

      {editable && draft.learningOutcomes.length < 7 ? (
        <button
          type="button"
          onClick={() => onEdit((next) => next.learningOutcomes.push(""))}
          className="mt-4 inline-flex rounded-full border border-dashed border-[#d1cabd] bg-white/55 px-4 py-2 text-[13px] font-black text-[#615a50] hover:border-[#bcb3a5] hover:bg-white"
        >
          + Add outcome
        </button>
      ) : null}
    </section>
  );
}

function ActiveModuleStudio({
  module,
  moduleIndex,
  outline,
  editable,
  conceptOptions,
  clearedAssets,
  suggestedAssets,
  onEdit,
}: {
  module: EditableModule;
  moduleIndex: number;
  outline: EditableOutline;
  editable: boolean;
  conceptOptions: ConceptOption[];
  clearedAssets: ClearedAssetOption[];
  suggestedAssets: Record<string, { caption: string | null; thumbKey: string | null; kind: string }>;
  onEdit: (mutator: (next: EditableOutline) => void) => void;
}) {
  const total = totalUnits(outline);
  return (
    <section className="mx-auto max-w-[1080px]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-[#9a9387]">
            <span className="rounded bg-[#ece8df] px-2 py-1 font-mono text-[10px] font-black text-[#8f877a]">
              {moduleLabel(module, moduleIndex)}
            </span>
            <span>module {moduleIndex + 1} of {outline.modules.length}</span>
          </div>
          <input
            value={module.title}
            disabled={!editable}
            aria-label={`Module ${moduleIndex + 1} title`}
            onChange={(event) =>
              onEdit((next) => {
                next.modules[moduleIndex].title = event.target.value;
              })
            }
            className="mt-3 block w-full border-0 bg-transparent p-0 text-[26px] font-black leading-8 tracking-[-0.045em] text-[#191816] outline-none disabled:opacity-100"
          />
          <textarea
            value={module.rationale}
            disabled={!editable}
            rows={2}
            aria-label={`Module ${moduleIndex + 1} rationale`}
            placeholder="Describe this module's purpose."
            onChange={(event) =>
              onEdit((next) => {
                next.modules[moduleIndex].rationale = event.target.value;
              })
            }
            className="mt-2 block w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-5 text-[#6e685e] outline-none placeholder:text-[#a7a095] disabled:opacity-100"
          />
          <div className="mt-3 flex items-center gap-4 text-[12px] font-black text-[#282621]">
            <span>{module.units.length} units</span>
            <span className="text-[#b0a99e]">·</span>
            <span>{formatRuntime(moduleDurationSeconds(module))} runtime</span>
          </div>
        </div>
        {editable ? (
          <div className="flex shrink-0 items-center gap-2">
            <StudioIconButton
              label="Move module up"
              icon="↑"
              disabled={moduleIndex === 0}
              onClick={() =>
                onEdit((next) => {
                  const [moved] = next.modules.splice(moduleIndex, 1);
                  next.modules.splice(moduleIndex - 1, 0, moved);
                })
              }
            />
            <StudioIconButton
              label="Move module down"
              icon="↓"
              disabled={moduleIndex === outline.modules.length - 1}
              onClick={() =>
                onEdit((next) => {
                  const [moved] = next.modules.splice(moduleIndex, 1);
                  next.modules.splice(moduleIndex + 1, 0, moved);
                })
              }
            />
            <button
              type="button"
              disabled={outline.modules.length <= 1}
              onClick={() => onEdit((next) => next.modules.splice(moduleIndex, 1))}
              className="h-8 rounded-lg border border-[#ddd8cf] bg-white px-3 text-[12px] font-black text-[#746d62] shadow-sm hover:border-[#c7bfb2] disabled:cursor-not-allowed disabled:opacity-35"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        {module.units.map((unit, unitIndex) => (
          <StudioUnitRow
            key={`${unit.unitId}-${unitIndex}`}
            unit={unit}
            unitIndex={unitIndex}
            module={module}
            moduleIndex={moduleIndex}
            outline={outline}
            editable={editable}
            conceptOptions={conceptOptions}
            clearedAssets={clearedAssets}
            suggestedAssets={suggestedAssets}
            totalUnits={total}
            onEdit={onEdit}
          />
        ))}
      </div>

      {editable ? (
        <div className="mt-4 inline-flex max-w-full items-center rounded-full border border-dashed border-[#d1cabd] bg-white/55 px-3 py-1.5">
          <span className="mr-1 text-[13px] font-black text-[#2f2c27]">+</span>
          <select
            value=""
            aria-label={`Add unit to ${module.title}`}
            onChange={(event) => {
              const key = event.target.value;
              if (!key) return;
              const concept = conceptOptions.find((entry) => entry.key === key);
              if (!concept) return;
              onEdit((next) => {
                next.modules[moduleIndex].units.push({
                  unitId: nextUnitId(next),
                  conceptKey: concept.key,
                  conceptTag: slugify(concept.key) || concept.key,
                  title: concept.title,
                  secondsBudget: 45,
                  mediaAssetIds: [],
                });
              });
            }}
            className="max-w-[280px] border-0 bg-transparent p-0 text-[13px] font-black text-[#615a50] outline-none"
          >
            <option value="">Add unit from an unused concept...</option>
            {conceptOptions.map((concept) => (
              <option key={concept.key} value={concept.key}>
                {concept.title} ({concept.key})
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </section>
  );
}

function StudioUnitRow({
  unit,
  unitIndex,
  module,
  moduleIndex,
  outline,
  editable,
  conceptOptions,
  clearedAssets,
  suggestedAssets,
  totalUnits,
  onEdit,
}: {
  unit: EditableUnit;
  unitIndex: number;
  module: EditableModule;
  moduleIndex: number;
  outline: EditableOutline;
  editable: boolean;
  conceptOptions: ConceptOption[];
  clearedAssets: ClearedAssetOption[];
  suggestedAssets: Record<string, { caption: string | null; thumbKey: string | null; kind: string }>;
  totalUnits: number;
  onEdit: (mutator: (next: EditableOutline) => void) => void;
}) {
  return (
    <article className="rounded-2xl border border-[#e2ded5] bg-white px-4 py-3 shadow-sm">
      <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[82px_minmax(0,1fr)_auto]">
        <div
          aria-label={`Unit ${outlineUnitLabel(moduleIndex, unitIndex)}`}
          className="h-7 rounded-md border border-[#e4dfd5] bg-[#f0ede5] px-2 text-center font-mono text-[11px] font-black leading-7 text-[#8d867a]"
        >
          {outlineUnitLabel(moduleIndex, unitIndex)}
        </div>

        <div className="min-w-0">
          <input
            value={unit.title}
            disabled={!editable}
            aria-label={`Unit ${unitIndex + 1} title`}
            onChange={(event) =>
              onEdit((next) => {
                next.modules[moduleIndex].units[unitIndex].title = event.target.value;
              })
            }
            className="block w-full border-0 bg-transparent p-0 text-[14px] font-black leading-5 text-[#25231f] outline-none disabled:opacity-100"
          />
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] font-semibold text-[#8b8377]">
            <span>concept:</span>
            <select
              value={unit.conceptKey}
              disabled={!editable}
              aria-label={`Concept for ${unit.title}`}
              onChange={(event) => {
                const concept = conceptOptions.find((entry) => entry.key === event.target.value);
                onEdit((next) => {
                  const target = next.modules[moduleIndex].units[unitIndex];
                  target.conceptKey = event.target.value;
                  target.conceptTag = slugify(event.target.value) || event.target.value;
                  if (concept && (!target.title.trim() || target.title === unit.title)) {
                    target.title = concept.title;
                  }
                });
              }}
              className="max-w-[220px] border-0 bg-transparent p-0 font-mono text-[10.5px] font-semibold text-[#8b8377] outline-none"
            >
              {conceptOptions.map((concept) => (
                <option key={concept.key} value={concept.key}>
                  {concept.key}
                </option>
              ))}
            </select>
            <span>· tag:</span>
            <input
              value={unit.conceptTag}
              disabled={!editable}
              aria-label={`Concept tag for ${unit.title}`}
              onChange={(event) =>
                onEdit((next) => {
                  next.modules[moduleIndex].units[unitIndex].conceptTag = slugify(event.target.value) || event.target.value;
                })
              }
              className="min-w-[120px] max-w-[220px] flex-1 border-0 bg-transparent p-0 font-mono text-[10.5px] font-semibold text-[#8b8377] outline-none disabled:opacity-100"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <label className="flex h-7 items-center gap-1 rounded-lg border border-[#e2ded5] bg-[#f4f2ed] px-2 text-[12px] font-black text-[#776f64]">
            <input
              type="number"
              min={20}
              max={90}
              value={unit.secondsBudget}
              disabled={!editable}
              aria-label={`Unit ${unitIndex + 1} seconds budget`}
              onChange={(event) =>
                onEdit((next) => {
                  next.modules[moduleIndex].units[unitIndex].secondsBudget = Number(event.target.value);
                })
              }
              className="w-8 border-0 bg-transparent p-0 text-right font-black outline-none disabled:opacity-100"
            />
            s
          </label>
          {clearedAssets.length > 0 ? (
            <select
              value=""
              disabled={!editable}
              aria-label={`Suggest media for ${unit.title}`}
              onChange={(event) => {
                const id = event.target.value;
                if (!id) return;
                onEdit((next) => {
                  const ids = next.modules[moduleIndex].units[unitIndex].mediaAssetIds;
                  if (!ids.includes(id) && ids.length < 3) ids.push(id);
                });
              }}
              className="h-7 max-w-[120px] rounded-lg border border-[#e2ded5] bg-[#f4f2ed] px-2 text-[12px] font-black text-[#776f64] outline-none disabled:opacity-45"
            >
              <option value="">{unit.mediaAssetIds.length > 0 ? `${unit.mediaAssetIds.length} asset` : "+ asset"}</option>
              {clearedAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  [{asset.kind}] {asset.caption ?? asset.id.slice(0, 12)}
                </option>
              ))}
            </select>
          ) : (
            <span className="flex h-7 items-center rounded-lg border border-[#e2ded5] bg-[#f4f2ed] px-2 text-[12px] font-black text-[#776f64]">
              {unit.mediaAssetIds.length > 0 ? `${unit.mediaAssetIds.length} asset` : "+ asset"}
            </span>
          )}
          <StudioIconButton
            label="Move unit up"
            icon="↑"
            disabled={!editable || unitIndex === 0}
            onClick={() =>
              onEdit((next) => {
                const units = next.modules[moduleIndex].units;
                const [moved] = units.splice(unitIndex, 1);
                units.splice(unitIndex - 1, 0, moved);
              })
            }
          />
          <StudioIconButton
            label="Move unit down"
            icon="↓"
            disabled={!editable || unitIndex === module.units.length - 1}
            onClick={() =>
              onEdit((next) => {
                const units = next.modules[moduleIndex].units;
                const [moved] = units.splice(unitIndex, 1);
                units.splice(unitIndex + 1, 0, moved);
              })
            }
          />
          <StudioIconButton
            label="Delete unit"
            icon="×"
            disabled={!editable || totalUnits <= 1 || module.units.length <= 1}
            onClick={() => onEdit((next) => next.modules[moduleIndex].units.splice(unitIndex, 1))}
          />
          <select
            value={module.moduleId}
            disabled={!editable}
            aria-label={`Move ${unit.title} to another module`}
            onChange={(event) =>
              onEdit((next) => {
                let targetModuleIndex = next.modules.findIndex((entry) => entry.moduleId === event.target.value);
                if (targetModuleIndex === -1 || targetModuleIndex === moduleIndex) return;
                const source = next.modules[moduleIndex];
                const [moved] = source.units.splice(unitIndex, 1);
                if (source.units.length === 0) {
                  next.modules.splice(moduleIndex, 1);
                  if (moduleIndex < targetModuleIndex) targetModuleIndex -= 1;
                }
                next.modules[targetModuleIndex].units.push(moved);
              })
            }
            className="h-7 w-7 rounded-lg border border-[#e2ded5] bg-white px-1 text-[11px] font-black text-[#8b8377] outline-none disabled:opacity-45"
          >
            {outline.modules.map((entry, entryIndex) => (
              <option key={entry.moduleId} value={entry.moduleId}>
                Move to {entry.title || formatModuleNumberLabel(entry.moduleId, entryIndex, { includeWord: true })}
              </option>
            ))}
          </select>
        </div>
      </div>
      {unit.mediaAssetIds.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2 pl-0 md:pl-[94px]">
          {unit.mediaAssetIds.map((assetId) => {
            const asset = suggestedAssets[assetId];
            return (
              <span key={assetId} className="inline-flex items-center gap-2 rounded-full bg-[#f0ede5] px-2.5 py-1 text-[11px] font-black text-[#726b60]">
                <span className="text-[#9c958a]">{asset?.kind ?? "asset"}</span>
                {asset?.caption ?? assetId.slice(0, 12)}
                {editable ? (
                  <button
                    type="button"
                    className="font-black text-[#9b4b3f]"
                    onClick={() =>
                      onEdit((next) => {
                        const ids = next.modules[moduleIndex].units[unitIndex].mediaAssetIds;
                        const index = ids.indexOf(assetId);
                        if (index >= 0) ids.splice(index, 1);
                      })
                    }
                  >
                    ×
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function StudioIconButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#e2ded5] bg-white text-[13px] font-black leading-none text-[#746d62] shadow-sm hover:border-[#c7bfb2] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {icon}
    </button>
  );
}

function EmptyDocumentState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[520px] items-center justify-center p-6">
      <div className="max-w-[520px] rounded-3xl border border-[#e1dcd2] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#efebe3] text-[#8d8578]">
          <span className="h-5 w-5 rounded-sm border-2 border-current" />
        </div>
        <h2 className="m-0 text-2xl font-black tracking-[-0.04em] text-[#191816]">{title}</h2>
        <p className="mx-auto mt-2 max-w-[420px] text-sm leading-6 text-[#6f695f]">{body}</p>
      </div>
    </div>
  );
}
