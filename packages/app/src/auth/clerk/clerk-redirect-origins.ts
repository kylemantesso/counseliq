const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3002",
];

function getAppWebOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_WEB_ORIGIN?.trim() ||
    process.env.APP_WEB_ORIGIN?.trim() ||
    "http://localhost:3000"
  );
}

/** Allowed OAuth redirect origins for Clerk (web). */
export function getClerkAllowedRedirectOrigins(): string[] {
  const origins = new Set<string>(DEFAULT_ORIGINS);
  origins.add(getAppWebOrigin());

  const extra = process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS;
  if (extra) {
    for (const origin of extra.split(",")) {
      const trimmed = origin.trim();
      if (trimmed) origins.add(trimmed);
    }
  }

  return [...origins];
}
