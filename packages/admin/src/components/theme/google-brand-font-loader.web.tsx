"use client";

import { useEffect, useMemo } from "react";
import {
  googleFontStylesheetHref,
  normalizeFontFamily,
  shouldLoadGoogleFont,
} from "../../theme/google-brand-fonts";

export function GoogleBrandFontLoader({
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

  useEffect(() => {
    for (const family of families) {
      if (!shouldLoadGoogleFont(family)) continue;
      const id = `ciq-google-font-${family
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")}`;

      let link = document.getElementById(id) as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        document.head.appendChild(link);
      }
      link.href = googleFontStylesheetHref(family);
    }
  }, [families]);

  return null;
}
