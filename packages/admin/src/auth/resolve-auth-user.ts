import type { User } from "./types";

/**
 * Merge the live Convex `currentUser` subscription with a session established
 * from a mutation result. The established user wins until the query catches up
 * with the same `userId`, preventing navigation races after signup.
 */
export function resolveAuthUser(
  queryUser: User | null | undefined,
  establishedUser: User | null
): User | null {
  if (queryUser) return queryUser;
  return establishedUser;
}

/** Drop the established session once the subscription reflects the same user. */
export function shouldClearEstablishedSession(
  queryUser: User | null | undefined,
  establishedUser: User | null
): boolean {
  return (
    queryUser !== undefined &&
    queryUser !== null &&
    establishedUser !== null &&
    queryUser.userId === establishedUser.userId
  );
}
