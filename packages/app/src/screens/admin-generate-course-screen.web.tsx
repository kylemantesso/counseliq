"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "solito/navigation";
import { Box, Button, ButtonText, Heading, Text } from "@counseliq/ui";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { Screen } from "../components/screen";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

/**
 * Generate course (M6) — the operator's "go" button. Pick an institution,
 * choose its source documents (upload new pptx/pdf or re-use ones already
 * ingested — content addressing makes re-runs cache-hit conversion and
 * extraction), see how much of the asset library is rights-cleared, and
 * start the full pipeline run. The run then walks the usual gates:
 * knowledge review → course review → studio preview → publish.
 */

const DOC_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  return { key: `sha256/${hex}.${ext}`, ext, bytes };
}

function GenerateCourseContent() {
  const institutions = useQuery(api.pipeline.assetsCatalogue.adminListInstitutions, {});
  const [institutionId, setInstitutionId] = useState<Id<"institutions"> | null>(null);
  const selected = institutionId ?? institutions?.[0]?._id ?? null;

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center">
        <Box>
          <Heading size="md">Generate course</Heading>
          <Text className="text-muted-foreground text-sm">
            Compile a course from an institution&apos;s approved facts and
            rights-cleared assets.
          </Text>
        </Box>
        {institutions && institutions.length > 0 ? (
          <select
            value={selected ?? ""}
            onChange={(e) => setInstitutionId(e.target.value as Id<"institutions">)}
            style={{ padding: 6, borderRadius: 8 }}
          >
            {institutions.map((inst) => (
              <option key={inst._id} value={inst._id}>
                {inst.name}
              </option>
            ))}
          </select>
        ) : null}
      </Box>
      {selected ? (
        <GenerateForInstitution key={selected} institutionId={selected} />
      ) : (
        <Box className="p-6">
          <Text className="text-muted-foreground">No institutions yet.</Text>
        </Box>
      )}
    </Screen>
  );
}

function GenerateForInstitution({ institutionId }: { institutionId: Id<"institutions"> }) {
  const router = useRouter();
  const allDocs = useQuery(api.pipeline.queries.listSourceDocs, {});
  const assets = useQuery(api.pipeline.assetsCatalogue.adminListAssets, { institutionId });
  const runs = useQuery(api.pipeline.queries.adminListRuns, { institutionId });
  const presignPutBatch = useAction(api.pipeline.objectStore.adminPresignPutBatch);
  const registerDoc = useMutation(api.pipeline.ingestion.adminRegisterSourceDoc);
  const startRun = useMutation(api.pipeline.runs.adminStartRun);

  const [selectedKeys, setSelectedKeys] = useState<Set<string> | null>(null);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One row per distinct document (newest registration wins) — re-running
  // with the same material re-registers a fresh row at generate time.
  const docs = useMemo(() => {
    const byKey = new Map<string, Doc<"sourceDocs">>();
    for (const doc of allDocs ?? []) {
      if (doc.institutionId !== institutionId) continue;
      if (!byKey.has(doc.objectKey)) byKey.set(doc.objectKey, doc);
    }
    return [...byKey.values()];
  }, [allDocs, institutionId]);

  // Default: every distinct document selected.
  const effectiveSelection = selectedKeys ?? new Set(docs.map((d) => d.objectKey));

  const clearedCount = assets?.filter((a) => a.cleared).length ?? 0;
  const clearedVideos =
    assets?.filter((a) => a.cleared && a.kind === "video").length ?? 0;

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy("Uploading document(s)…");
    try {
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
        if (!response.ok) throw new Error(`upload failed (${response.status})`);
        await registerDoc({
          institutionId,
          objectKey: key,
          kind: ext as "pdf" | "pptx",
        });
        setSelectedKeys((prev) => {
          const next = new Set(prev ?? docs.map((d) => d.objectKey));
          next.add(key);
          return next;
        });
      }
      setBusy(null);
    } catch (uploadError) {
      setBusy(null);
      setError(
        uploadError instanceof Error ? uploadError.message : String(uploadError)
      );
    }
  }

  async function generate() {
    setError(null);
    const chosen = docs.filter((doc) => effectiveSelection.has(doc.objectKey));
    if (chosen.length === 0) {
      setError("Select at least one source document.");
      return;
    }
    setBusy("Starting pipeline run…");
    try {
      const sourceDocIds: Id<"sourceDocs">[] = [];
      for (const doc of chosen) {
        if (doc.runId === undefined) {
          // Fresh registration not yet consumed by a run — use it directly.
          sourceDocIds.push(doc._id);
        } else {
          // Already belongs to an earlier run's history: mint a fresh row
          // for the same content-addressed bytes (conversion cache-hits).
          sourceDocIds.push(
            await registerDoc({
              institutionId,
              objectKey: doc.objectKey,
              kind: doc.kind as "pdf" | "pptx",
            })
          );
        }
      }
      const runId = await startRun({
        institutionId,
        sourceDocIds,
        ...(brief.trim() ? { brief: brief.trim() } : {}),
      });
      router.push(`/admin/runs/${runId}`);
    } catch (startError) {
      setBusy(null);
      setError(
        getUserFacingErrorMessage(startError, "Could not start the run. Try again.")
      );
    }
  }

  return (
    <Box className="flex-1 p-6 gap-4" style={{ overflow: "auto" } as never}>
      <Box className="bg-card border border-border rounded-xl p-4 gap-3">
        <Text className="font-semibold">1 · Source documents</Text>
        <Text className="text-sm text-muted-foreground">
          The knowledge inventory is extracted from these. Re-using unchanged
          documents is cheap — conversion and per-page extraction are cached
          by content.
        </Text>
        {docs.length === 0 ? (
          <Text className="text-sm text-muted-foreground">
            No documents yet — upload the institution&apos;s source deck(s).
          </Text>
        ) : (
          docs.map((doc) => (
            <label
              key={doc.objectKey}
              style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}
            >
              <input
                type="checkbox"
                checked={effectiveSelection.has(doc.objectKey)}
                onChange={() => {
                  setSelectedKeys(() => {
                    const next = new Set(effectiveSelection);
                    if (next.has(doc.objectKey)) next.delete(doc.objectKey);
                    else next.add(doc.objectKey);
                    return next;
                  });
                }}
              />
              <span style={{ fontWeight: 600 }}>{doc.kind.toUpperCase()}</span>
              <span style={{ color: "#71717a", fontSize: 12 }}>
                {doc.objectKey.slice(7, 19)}…
                {doc.pageCount !== undefined ? ` · ${doc.pageCount} pages` : ""}
                {doc.status === "converted" ? " · previously converted" : ` · ${doc.status}`}
              </span>
            </label>
          ))
        )}
        <label
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid #d4d4d8",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
            alignSelf: "flex-start",
          }}
        >
          Upload .pdf / .pptx
          <input
            type="file"
            multiple
            accept=".pdf,.pptx"
            style={{ display: "none" }}
            onChange={(e) => {
              void handleUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </Box>

      <Box className="bg-card border border-border rounded-xl p-4 gap-2">
        <Text className="font-semibold">2 · Asset library</Text>
        {assets === undefined ? (
          <Text className="text-sm text-muted-foreground">Loading…</Text>
        ) : (
          <Text className="text-sm">
            {clearedCount} of {assets.length} assets rights-cleared
            {clearedVideos > 0 ? ` (${clearedVideos} video)` : ""} — the
            compiler weaves cleared media through the course
            {clearedCount === 0
              ? ". None cleared yet: the course will compile media-free."
              : "."}
          </Text>
        )}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onPress={() => router.push("/admin/assets")}
        >
          <ButtonText>Open asset library</ButtonText>
        </Button>
      </Box>

      <Box className="bg-card border border-border rounded-xl p-4 gap-2">
        <Text className="font-semibold">3 · Course brief (optional)</Text>
        <Text className="text-sm text-muted-foreground">
          Describe the course&apos;s purpose, audience emphasis, and desired
          learning outcomes. The outline generator follows this brief when
          choosing what the course should cover — source documents often
          contain more than one course&apos;s worth of material.
        </Text>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. Focus on clinical placements and rural health. Outcomes: the counsellor can match students to registration-track courses and explain placement requirements."
          rows={4}
          style={{
            padding: 10,
            borderRadius: 8,
            border: "1px solid #d4d4d8",
            fontSize: 14,
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
      </Box>

      <Box className="bg-card border border-border rounded-xl p-4 gap-3">
        <Text className="font-semibold">4 · Generate</Text>
        <Text className="text-sm text-muted-foreground">
          Starts the pipeline: convert → extract → gate 1 (facts) → an
          EDITABLE course outline you approve → compile → judge → gate 2 →
          voice → gate 3 → publish. Uses real LLM calls.
        </Text>
        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
        <Button
          className="self-start"
          disabled={busy !== null || docs.length === 0}
          onPress={() => void generate()}
        >
          <ButtonText>{busy ?? "Generate course"}</ButtonText>
        </Button>
      </Box>

      <Box className="bg-card border border-border rounded-xl p-4 gap-2">
        <Text className="font-semibold">Recent runs</Text>
        {runs === undefined ? (
          <Text className="text-sm text-muted-foreground">Loading…</Text>
        ) : runs.length === 0 ? (
          <Text className="text-sm text-muted-foreground">No runs yet.</Text>
        ) : (
          runs.map((run) => (
            <button
              key={run._id}
              onClick={() => router.push(`/admin/runs/${run._id}`)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "6px 4px",
                background: "none",
                border: "none",
                borderBottom: "1px solid #f0f0f2",
                cursor: "pointer",
                fontSize: 13,
                textAlign: "left",
              }}
            >
              <span style={{ fontFamily: "monospace" }}>{run.state}</span>
              <span style={{ color: "#71717a" }}>
                {new Date(run._creationTime).toLocaleString()}
                {run.error ? " · error" : ""}
              </span>
            </button>
          ))
        )}
      </Box>
    </Box>
  );
}
