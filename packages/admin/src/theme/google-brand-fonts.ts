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

export const GOOGLE_BRAND_FONT_OPTIONS = [
  "Inter",
  "Montserrat",
  "Poppins",
  "Lato",
  "Roboto",
  "Nunito",
  "Open Sans",
  "Oswald",
  "Merriweather",
  "Playfair Display",
  "Source Sans 3",
  "Source Serif 4",
  "Barlow",
  "Barlow Condensed",
  "IBM Plex Sans",
  "IBM Plex Serif",
  "IBM Plex Mono",
  "Noto Sans",
  "Noto Serif",
  "Work Sans",
  "Rubik",
  "Rethink Sans",
] as const;

export function normalizeFontFamily(value: string | null | undefined): string | null {
  if (!value) return null;
  const firstFamily = value.split(",")[0]?.trim();
  if (!firstFamily) return null;
  const unquoted = firstFamily.replace(/^['\"]|['\"]$/g, "").trim();
  return unquoted.length > 0 ? unquoted : null;
}

export function shouldLoadGoogleFont(family: string | null | undefined): boolean {
  const normalized = normalizeFontFamily(family);
  if (!normalized) return false;
  return !GENERIC_FONT_FAMILIES.has(normalized.toLowerCase());
}

export function googleFontStylesheetHref(family: string): string {
  const normalized = normalizeFontFamily(family) ?? family;
  const encodedFamily = normalized.replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@400;500;600;700&display=swap`;
}

export function fontFamilyFromBrandTokens(tokens: unknown): string | null {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    return null;
  }
  const record = tokens as Record<string, unknown>;
  if (typeof record.titleFontFamily === "string") {
    const titleFontFamily = normalizeFontFamily(record.titleFontFamily);
    if (titleFontFamily !== null) return titleFontFamily;
  }
  if (typeof record.fontFamily === "string") {
    return normalizeFontFamily(record.fontFamily);
  }
  if (Array.isArray(record.fonts)) {
    const first = record.fonts.find((value): value is string => typeof value === "string");
    return normalizeFontFamily(first ?? null);
  }
  return null;
}
