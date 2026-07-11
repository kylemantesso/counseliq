import { useEffect, useMemo, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";

const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "system-ui",
  "inherit",
  "initial",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
]);

const FONT_LOAD_TIMEOUT_MS = 8000;
const FONT_WEIGHTS = ["400", "500", "600", "700"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFontFamily(value: string | null | undefined): string | null {
  if (!value) return null;
  const firstFamily = value.split(",")[0]?.trim();
  if (!firstFamily) return null;
  const unquoted = firstFamily.replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "").trim();
  return unquoted.length > 0 ? unquoted : null;
}

function shouldLoadGoogleFont(family: string | null | undefined): boolean {
  const normalized = normalizeFontFamily(family);
  if (!normalized) return false;
  return !GENERIC_FONT_FAMILIES.has(normalized.toLowerCase());
}

function googleFontStylesheetHref(family: string): string {
  const normalized = normalizeFontFamily(family) ?? family;
  const encodedFamily = normalized.replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@400;500;600;700&display=swap`;
}

export function fontFamilyFromThemeTokens(tokens: unknown): string | null {
  if (!isRecord(tokens)) return null;
  if (typeof tokens.fontFamily === "string") {
    return normalizeFontFamily(tokens.fontFamily);
  }
  if (Array.isArray(tokens.fonts)) {
    const first = tokens.fonts.find((value): value is string => typeof value === "string");
    return normalizeFontFamily(first ?? null);
  }
  return null;
}

function fontLinkId(family: string): string {
  return `ciq-google-font-${family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

function waitForStylesheet(family: string): Promise<void> {
  const href = googleFontStylesheetHref(family);
  const id = fontLinkId(family);
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (link?.dataset.ciqLoaded === "true" && link.href === href) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }

    link.onload = () => {
      link!.dataset.ciqLoaded = "true";
      resolve();
    };
    // Do not render with a late-swap font if Google fails; proceed with the
    // stable fallback stack rather than snapping after capture starts.
    link.onerror = () => resolve();

    if (link.href !== href) {
      link.dataset.ciqLoaded = "false";
      link.href = href;
    }
  });
}

async function loadFontFamily(family: string): Promise<void> {
  if (!shouldLoadGoogleFont(family)) return;
  await waitForStylesheet(family);
  await Promise.all(
    FONT_WEIGHTS.map((weight) => document.fonts.load(`${weight} 16px "${family}"`))
  );
}

export function RemotionBrandFontLoader({
  fontFamily,
  fontFamilies,
}: {
  fontFamily?: string | null;
  fontFamilies?: Array<string | null | undefined>;
}) {
  const fontSignature = [fontFamily, ...(fontFamilies ?? [])].join("\u0000");
  const families = useMemo(() => {
    const normalized = [fontFamily, ...(fontFamilies ?? [])]
      .map((family) => normalizeFontFamily(family))
      .filter((family): family is string => family !== null);
    return [...new Set(normalized)];
  }, [fontSignature]);
  const familiesSignature = families.join("\u0000");
  const [handle] = useState(() => delayRender("Loading brand fonts"));

  useEffect(() => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cancelRender(new Error(`Timed out loading brand fonts: ${families.join(", ") || "none"}`));
    }, FONT_LOAD_TIMEOUT_MS);

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      continueRender(handle);
    };

    void Promise.all(families.map(loadFontFamily))
      .then(() => document.fonts.ready)
      .then(finish, finish);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [families, familiesSignature, handle]);

  return null;
}
