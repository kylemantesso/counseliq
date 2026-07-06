import type { UserIdentity } from "convex/server";

export const PLACEHOLDER_USER_NAME = "User";
export const USER_DISPLAY_NAME_MAX_LENGTH = 80;

function claimString(identity: UserIdentity, key: string): string | undefined {
  const value = (identity as Record<string, unknown>)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Resolve a display name from Convex JWT identity claims (OAuth-safe). */
export function resolveIdentityDisplayName(identity: UserIdentity): string {
  const direct =
    identity.name?.trim() ||
    identity.nickname?.trim() ||
    claimString(identity, "full_name");

  if (direct && !isPlaceholderUserName(direct)) {
    return clampDisplayName(direct);
  }

  const given =
    claimString(identity, "given_name") ?? claimString(identity, "first_name");
  const family =
    claimString(identity, "family_name") ?? claimString(identity, "last_name");
  const combined = [given, family].filter(Boolean).join(" ").trim();
  if (combined.length >= 2) {
    return clampDisplayName(combined);
  }

  return PLACEHOLDER_USER_NAME;
}

export function isPlaceholderUserName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length === 0 || trimmed === PLACEHOLDER_USER_NAME;
}

function clampDisplayName(name: string): string {
  return name.slice(0, USER_DISPLAY_NAME_MAX_LENGTH);
}

/** Prefer JWT claims; fall back to Clerk profile when the token has no name yet. */
export function pickUserDisplayName(
  identity: UserIdentity,
  clerkDisplayName?: string
): string {
  const fromIdentity = resolveIdentityDisplayName(identity);
  if (!isPlaceholderUserName(fromIdentity)) {
    return fromIdentity;
  }

  const fromClerk = clerkDisplayName?.trim();
  if (
    fromClerk &&
    fromClerk.length >= 2 &&
    !isPlaceholderUserName(fromClerk)
  ) {
    return clampDisplayName(fromClerk);
  }

  return PLACEHOLDER_USER_NAME;
}
