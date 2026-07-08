"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Box, Button, ButtonText, Heading, Text } from "@counseliq/ui";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { Screen } from "../components/screen";
import { api } from "../db/api";

/**
 * Asset library (M6) — upload, browse, tag-edit, and above all DECLARE
 * RIGHTS. This page is where the operator rights session happens: every
 * asset lands "unknown" (unusable) and only the declarations made here can
 * clear it for compilation. The usable badge mirrors the same
 * isAssetCleared predicate the compiler filter uses.
 */

type LibraryAsset = Doc<"assets"> & { cleared: boolean };

const RIGHTS_LABELS: Record<string, string> = {
  unknown: "Rights unknown",
  institution_owned: "Institution owned",
  licensed: "Licensed",
};

export function AdminAssetLibraryScreen() {
  return (
    <AdminGuard>
      <AssetLibraryContent />
    </AdminGuard>
  );
}

/** sha256 content-addressed key for a browser File (walkthrough.mjs scheme). */
async function contentKeyForFile(file: File): Promise<{ key: string; bytes: ArrayBuffer }> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  return { key: `sha256/${hex}.${ext}`, bytes };
}

function AssetLibraryContent() {
  const institutions = useQuery(api.pipeline.assetsCatalogue.adminListInstitutions, {});
  const [institutionId, setInstitutionId] = useState<Id<"institutions"> | null>(null);
  const selected = institutionId ?? institutions?.[0]?._id ?? null;

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center">
        <Heading size="md">Asset library</Heading>
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
        <InstitutionLibrary institutionId={selected} />
      ) : (
        <Box className="p-6">
          <Text className="text-muted-foreground">No institutions yet.</Text>
        </Box>
      )}
    </Screen>
  );
}

function InstitutionLibrary({ institutionId }: { institutionId: Id<"institutions"> }) {
  const assets = useQuery(api.pipeline.assetsCatalogue.adminListAssets, { institutionId });
  const jobs = useQuery(api.pipeline.assetsCatalogue.adminListIngestJobs, { institutionId });
  const presignGetBatch = useAction(api.pipeline.objectStore.adminPresignGetBatch);
  const presignPutBatch = useAction(api.pipeline.objectStore.adminPresignPutBatch);
  const ingestAssets = useAction(api.pipeline.assetsIngest.adminIngestAssets);
  const declareRights = useMutation(api.pipeline.assetsCatalogue.adminDeclareAssetRights);

  const [urls, setUrls] = useState<Record<string, string>>({});
  const [kindFilter, setKindFilter] = useState("all");
  const [rightsFilter, setRightsFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<string | null>(null);
  const [lightboxAsset, setLightboxAsset] = useState<LibraryAsset | null>(null);

  useEffect(() => {
    if (!assets || assets.length === 0) return;
    const keys = assets
      .map((a) => a.thumbKey ?? (a.kind === "image" ? a.objectKey : null))
      .filter((key): key is string => key !== null);
    if (keys.length === 0) return;
    let cancelled = false;
    presignGetBatch({ keys })
      .then((entries) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const entry of entries) map[entry.key] = entry.url;
        setUrls(map);
      })
      .catch(() => {
        // Object store may not be configured; metadata still renders.
      });
    return () => {
      cancelled = true;
    };
  }, [assets, presignGetBatch]);

  const filtered = useMemo(() => {
    if (!assets) return [];
    const needle = tagFilter.trim().toLowerCase();
    return assets.filter((asset) => {
      if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
      if (rightsFilter === "usable" && !asset.cleared) return false;
      if (rightsFilter === "unusable" && asset.cleared) return false;
      if (
        rightsFilter !== "all" &&
        rightsFilter !== "usable" &&
        rightsFilter !== "unusable" &&
        (asset.rights ?? "unknown") !== rightsFilter
      ) {
        return false;
      }
      if (originFilter !== "all" && asset.origin !== originFilter) return false;
      if (needle) {
        const haystack = [
          asset.caption ?? "",
          asset.originalName ?? "",
          ...(asset.tags ?? []),
          ...(asset.subjects ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [assets, kindFilter, rightsFilter, originFilter, tagFilter]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(`Hashing ${files.length} file(s)…`);
    try {
      const prepared = await Promise.all(
        Array.from(files).map(async (file) => ({
          file,
          ...(await contentKeyForFile(file)),
        }))
      );
      setUploading("Requesting upload URLs…");
      const putUrls = await presignPutBatch({
        items: prepared.map((entry) => ({
          key: entry.key,
          contentType: entry.file.type || "application/octet-stream",
        })),
      });
      const urlByKey = new Map(putUrls.map((entry) => [entry.key, entry.url]));
      for (const [index, entry] of prepared.entries()) {
        setUploading(`Uploading ${index + 1}/${prepared.length}…`);
        const url = urlByKey.get(entry.key);
        if (!url) continue;
        const response = await fetch(url, {
          method: "PUT",
          headers: { "content-type": entry.file.type || "application/octet-stream" },
          body: entry.bytes,
        });
        if (!response.ok) throw new Error(`upload failed (${response.status})`);
      }
      setUploading("Dispatching processing job…");
      await ingestAssets({
        institutionId,
        files: prepared.map((entry) => ({
          sourceKey: entry.key,
          originalName: entry.file.name,
        })),
      });
      setUploading(null);
    } catch (error) {
      setUploading(
        `Upload failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async function declareSelected(rights: "institution_owned" | "licensed" | "unknown") {
    if (selectedIds.size === 0) return;
    await declareRights({
      assetIds: [...selectedIds] as Id<"assets">[],
      rights,
    });
    setSelectedIds(new Set());
  }

  const latestJob = jobs?.[0];

  return (
    <Box className="flex-1 p-6 gap-4" style={{ overflow: "auto" } as never}>
      <Box className="bg-card border border-border rounded-xl p-4 gap-3">
        <Box className="flex-row items-center gap-3 flex-wrap">
          <label
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #d4d4d8",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Upload images / video / zip
            <input
              type="file"
              multiple
              accept="image/*,video/*,.zip"
              style={{ display: "none" }}
              onChange={(e) => {
                void handleUpload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {uploading ? (
            <Text className="text-sm text-muted-foreground">{uploading}</Text>
          ) : latestJob ? (
            <Text className="text-sm text-muted-foreground">
              Last upload: {latestJob.status}
              {latestJob.acceptedCount !== undefined
                ? ` · ${latestJob.acceptedCount} accepted`
                : ""}
              {latestJob.rejected && latestJob.rejected.length > 0
                ? ` · ${latestJob.rejected.length} rejected`
                : ""}
            </Text>
          ) : null}
        </Box>
        {latestJob?.rejected && latestJob.rejected.length > 0 ? (
          <Box className="gap-1">
            {latestJob.rejected.map((entry) => (
              <Text key={entry.originalName} className="text-xs text-destructive">
                {entry.originalName}: {entry.reason}
              </Text>
            ))}
          </Box>
        ) : null}
        <Box className="flex-row gap-2 flex-wrap items-center">
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
            <option value="all">All kinds</option>
            <option value="image">Images</option>
            <option value="video">Video</option>
          </select>
          <select value={rightsFilter} onChange={(e) => setRightsFilter(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
            <option value="all">All rights</option>
            <option value="usable">Usable</option>
            <option value="unusable">Unusable</option>
            <option value="unknown">Rights unknown</option>
            <option value="institution_owned">Institution owned</option>
            <option value="licensed">Licensed</option>
          </select>
          <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
            <option value="all">All origins</option>
            <option value="uploaded">Uploaded</option>
            <option value="deck_extracted">Deck extracted</option>
          </select>
          <input
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            placeholder="Filter by tag / caption"
            style={{ padding: 6, borderRadius: 8, border: "1px solid #d4d4d8", minWidth: 220 }}
          />
          <Text className="text-sm text-muted-foreground">
            {filtered.length} of {assets?.length ?? 0} assets
          </Text>
          <Button
            size="sm"
            variant="outline"
            onPress={() => {
              // Toggles over the FILTERED set: with a filter active this is
              // "select everything I'm looking at", not the whole library.
              setSelectedIds((prev) => {
                const allFiltered = filtered.every((asset) => prev.has(asset._id));
                if (allFiltered && filtered.length > 0) return new Set();
                return new Set(filtered.map((asset) => asset._id));
              });
            }}
          >
            <ButtonText>
              {filtered.length > 0 &&
              filtered.every((asset) => selectedIds.has(asset._id))
                ? "Clear selection"
                : `Select all (${filtered.length})`}
            </ButtonText>
          </Button>
        </Box>
        {selectedIds.size > 0 ? (
          <Box className="flex-row gap-2 items-center flex-wrap">
            <Text className="text-sm font-semibold">
              {selectedIds.size} selected — declare rights:
            </Text>
            <Button size="sm" onPress={() => void declareSelected("institution_owned")}>
              <ButtonText>Institution owned</ButtonText>
            </Button>
            <Button size="sm" onPress={() => void declareSelected("licensed")}>
              <ButtonText>Licensed</ButtonText>
            </Button>
            <Button size="sm" variant="outline" onPress={() => void declareSelected("unknown")}>
              <ButtonText>Revoke (unknown)</ButtonText>
            </Button>
          </Box>
        ) : null}
      </Box>

      {assets === undefined ? (
        <Text>Loading…</Text>
      ) : filtered.length === 0 ? (
        <Text className="text-muted-foreground">No assets match.</Text>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {filtered.map((asset) => (
            <AssetCard
              key={asset._id}
              asset={asset}
              url={urls[asset.thumbKey ?? asset.objectKey] ?? null}
              selected={selectedIds.has(asset._id)}
              onToggleSelect={() => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(asset._id)) next.delete(asset._id);
                  else next.add(asset._id);
                  return next;
                });
              }}
              onOpen={() => setLightboxAsset(asset)}
            />
          ))}
        </div>
      )}
      {lightboxAsset ? (
        <AssetLightbox
          asset={lightboxAsset}
          onClose={() => setLightboxAsset(null)}
        />
      ) : null}
    </Box>
  );
}

/**
 * Full-size viewer: presigns the asset's objectKey on open (the grid only
 * holds thumbnails/posters), renders the full image or a playable video,
 * closes on backdrop click or Escape. URLs are used in-place, never logged.
 */
function AssetLightbox({
  asset,
  onClose,
}: {
  asset: LibraryAsset;
  onClose: () => void;
}) {
  const presignGetBatch = useAction(api.pipeline.objectStore.adminPresignGetBatch);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFullUrl(null);
    setFailed(false);
    presignGetBatch({ keys: [asset.objectKey] })
      .then((entries) => {
        if (cancelled) return;
        setFullUrl(entries[0]?.url ?? null);
        if (!entries[0]?.url) setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.objectKey, presignGetBatch]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const durationLabel =
    asset.durationMs !== undefined
      ? ` · ${Math.round(asset.durationMs / 1000)}s`
      : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={asset.caption ?? asset.originalName ?? "asset preview"}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(9, 11, 14, 0.88)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 32,
        cursor: "zoom-out",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          maxWidth: "92vw",
          maxHeight: "82vh",
          display: "flex",
          cursor: "default",
        }}
      >
        {failed ? (
          <span style={{ color: "#e8e6e1", fontSize: 14 }}>
            Could not load the full-size asset.
          </span>
        ) : !fullUrl ? (
          <span style={{ color: "#9aa3ad", fontSize: 14 }}>Loading…</span>
        ) : asset.kind === "video" ? (
          // Transcoded library video has no audio track (-an) — controls are
          // for scrubbing. autoPlay is safe: the click that opened this IS
          // the user gesture.
          <video
            src={fullUrl}
            controls
            autoPlay
            loop
            muted
            playsInline
            style={{
              maxWidth: "92vw",
              maxHeight: "82vh",
              borderRadius: 10,
              background: "#000",
            }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fullUrl}
            alt={asset.caption ?? asset.originalName ?? "asset"}
            style={{
              maxWidth: "92vw",
              maxHeight: "82vh",
              objectFit: "contain",
              borderRadius: 10,
            }}
          />
        )}
      </div>
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          color: "#e8e6e1",
          fontSize: 13,
          maxWidth: "80vw",
          textAlign: "center",
          cursor: "default",
        }}
      >
        {asset.caption ?? asset.originalName ?? "(untagged)"}
        <span style={{ color: "#9aa3ad" }}>
          {" "}
          — {asset.kind}
          {durationLabel}
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
          {asset.cleared ? " · usable" : " · unusable"}
        </span>
      </div>
      <button
        onClick={onClose}
        aria-label="Close preview"
        style={{
          position: "fixed",
          top: 16,
          right: 20,
          background: "none",
          border: "none",
          color: "#e8e6e1",
          fontSize: 28,
          cursor: "pointer",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

function AssetCard({
  asset,
  url,
  selected,
  onToggleSelect,
  onOpen,
}: {
  asset: LibraryAsset;
  url: string | null;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const declareRights = useMutation(api.pipeline.assetsCatalogue.adminDeclareAssetRights);
  const confirmConsent = useMutation(api.pipeline.assetsCatalogue.adminConfirmPeopleConsent);
  const updateMeta = useMutation(api.pipeline.assetsCatalogue.adminUpdateAssetMeta);
  const retag = useAction(api.pipeline.assetsTagging.adminRetagAsset);
  const [editingCaption, setEditingCaption] = useState<string | null>(null);

  const durationLabel =
    asset.durationMs !== undefined
      ? `${Math.round(asset.durationMs / 1000)}s`
      : null;

  return (
    <div
      style={{
        border: `2px solid ${asset.cleared ? "#16a34a" : "#d4d4d8"}`,
        borderRadius: 12,
        overflow: "hidden",
        background: "white",
        opacity: asset.cleared ? 1 : 0.92,
      }}
    >
      <div style={{ position: "relative", aspectRatio: "4/3", background: "#f4f4f5" }}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={asset.caption ?? asset.originalName ?? "asset"}
            title="Click to view full size"
            onClick={onOpen}
            style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#a1a1aa", fontSize: 12 }}>
            no preview
          </div>
        )}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          style={{ position: "absolute", top: 8, left: 8, width: 18, height: 18 }}
        />
        {asset.kind === "video" ? (
          <span style={badgeStyle("#111827")}>
            ▶ video{durationLabel ? ` · ${durationLabel}` : ""}
          </span>
        ) : null}
        <span
          style={{
            ...badgeStyle(asset.cleared ? "#16a34a" : "#b91c1c"),
            top: 8,
            right: 8,
            left: "auto",
            bottom: "auto",
          }}
        >
          {asset.cleared ? "usable" : "unusable"}
        </span>
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {editingCaption !== null ? (
          <input
            value={editingCaption}
            autoFocus
            onChange={(e) => setEditingCaption(e.target.value)}
            onBlur={() => {
              if (editingCaption.trim()) {
                void updateMeta({ assetId: asset._id, caption: editingCaption.trim() });
              }
              setEditingCaption(null);
            }}
            style={{ fontSize: 13, padding: 4, borderRadius: 6, border: "1px solid #d4d4d8" }}
          />
        ) : (
          <div
            style={{ fontSize: 13, fontWeight: 600, cursor: "text" }}
            title="Click to edit caption"
            onClick={() => setEditingCaption(asset.caption ?? "")}
          >
            {asset.caption ?? asset.originalName ?? "(untagged — caption pending)"}
          </div>
        )}
        {asset.tags && asset.tags.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {asset.tags.map((tag) => (
              <span key={tag} style={{ fontSize: 10, background: "#f4f4f5", borderRadius: 999, padding: "2px 8px" }}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        <div style={{ fontSize: 11, color: "#71717a" }}>
          {asset.origin === "deck_extracted" ? "deck" : "uploaded"}
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
          {asset.aspect ? ` · ${asset.aspect}` : ""}
          {asset.taggedAt === undefined ? " · tagging…" : ""}
        </div>
        <select
          value={asset.rights ?? "unknown"}
          onChange={(e) =>
            void declareRights({
              assetIds: [asset._id],
              rights: e.target.value as "institution_owned" | "licensed" | "unknown",
            })
          }
          style={{
            padding: 4,
            borderRadius: 6,
            fontSize: 12,
            border: `1px solid ${asset.rights === "unknown" || asset.rights === undefined ? "#f87171" : "#d4d4d8"}`,
          }}
        >
          {Object.entries(RIGHTS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {asset.rightsDeclaredBy ? (
          <div style={{ fontSize: 10, color: "#a1a1aa" }}>
            declared by {asset.rightsDeclaredBy}
          </div>
        ) : null}
        {asset.identifiablePeople === true ? (
          <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", color: asset.peopleConsentConfirmed ? "#16a34a" : "#b91c1c" }}>
            <input
              type="checkbox"
              checked={asset.peopleConsentConfirmed === true}
              onChange={(e) =>
                void confirmConsent({ assetId: asset._id, confirmed: e.target.checked })
              }
            />
            identifiable people — consent confirmed
          </label>
        ) : null}
        <button
          onClick={() => void retag({ assetId: asset._id })}
          style={{ fontSize: 11, color: "#71717a", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
        >
          re-tag
        </button>
      </div>
    </div>
  );
}

function badgeStyle(background: string): React.CSSProperties {
  return {
    position: "absolute",
    bottom: 8,
    left: 8,
    background,
    color: "white",
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.04em",
  };
}
