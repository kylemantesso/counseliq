"use client";

import { useEffect } from "react";
import {
  googleFontStylesheetHref,
  normalizeFontFamily,
  shouldLoadGoogleFont,
} from "../../theme/google-brand-fonts";

export function GoogleBrandFontLoader({
  fontFamily,
}: {
  fontFamily?: string | null;
}) {
  const normalized = normalizeFontFamily(fontFamily);

  useEffect(() => {
    if (!shouldLoadGoogleFont(normalized)) return;
    const family = normalized as string;
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
  }, [normalized]);

  return null;
}
