/** Clerk user shape shared by @clerk/clerk-expo and @clerk/nextjs. */
type ClerkNameFields = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/** Display name from Clerk profile (OAuth often has first/last without fullName). */
export function clerkUserDisplayName(
  user: ClerkNameFields | null | undefined
): string | undefined {
  if (!user) return undefined;

  const full = user.fullName?.trim();
  if (full && full.length >= 2) return full;

  const combined = [user.firstName?.trim(), user.lastName?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (combined.length >= 2) return combined;

  return undefined;
}
