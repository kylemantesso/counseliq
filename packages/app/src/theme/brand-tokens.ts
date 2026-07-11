function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function logoUrlFromBrandTokens(tokens: unknown): string | null {
  if (!isRecord(tokens)) return null;
  return readHttpUrl(tokens.logoUrl);
}

export function withInstitutionLogoOnTitleCard(
  template: string,
  props: Record<string, unknown>,
  logoUrl: string | null | undefined
): Record<string, unknown> {
  if (template !== "title-card") return props;
  if (!logoUrl) return props;
  if (typeof props.logoUrl === "string" && props.logoUrl.trim().length > 0) {
    return props;
  }
  return { ...props, logoUrl };
}
