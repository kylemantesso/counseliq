import { useEffect, useMemo, useState } from "react";
import { continueRender, delayRender } from "remotion";
import type { CourseDefinition } from "@counseliq/course-schema";

type UnitDefinition = CourseDefinition["modules"][number]["microUnits"][number];

const ASSET_LOAD_TIMEOUT_MS = 12000;
const IMAGE_REF_KEYS = new Set(["assetRef", "imageRef", "bgAssetRef"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addUrl(urls: Set<string>, value: string | null | undefined): void {
  if (typeof value === "string" && value.length > 0) urls.add(value);
}

function collectCardVisualUrls(
  template: string,
  props: Record<string, unknown>,
  assetUrls: Record<string, string>,
  urls: Set<string>
): void {
  if (template === "video-card") {
    if (typeof props.assetRef === "string") {
      addUrl(urls, assetUrls[`poster:${props.assetRef}`]);
    }
    return;
  }

  for (const [key, value] of Object.entries(props)) {
    if (IMAGE_REF_KEYS.has(key) && typeof value === "string") {
      addUrl(urls, assetUrls[value]);
    }
  }
}

export function visualAssetUrlsForUnit({
  unit,
  assetUrls,
  institutionLogoUrl,
}: {
  unit: UnitDefinition;
  assetUrls: Record<string, string>;
  institutionLogoUrl?: string | null;
}): string[] {
  const urls = new Set<string>();
  addUrl(urls, institutionLogoUrl ?? null);
  for (const card of unit.content.cards) {
    if (!isRecord(card.props)) continue;
    collectCardVisualUrls(card.template, card.props, assetUrls, urls);
  }
  return [...urls];
}

function loadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
    if (img.complete) resolve();
  });
}

export function RemotionVisualAssetPreloader({ urls }: { urls: string[] }) {
  const urlSignature = urls.join("\u0000");
  const stableUrls = useMemo(() => [...new Set(urls)], [urlSignature]);
  const [handle] = useState(() => delayRender("Loading visual assets"));

  useEffect(() => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      continueRender(handle);
    }, ASSET_LOAD_TIMEOUT_MS);

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      continueRender(handle);
    };

    void Promise.all(stableUrls.map(loadImage)).then(finish, finish);

    return () => window.clearTimeout(timeout);
  }, [handle, stableUrls, urlSignature]);

  return null;
}
