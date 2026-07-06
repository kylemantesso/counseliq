import type { Doc } from "./_generated/dataModel";

function adminEmailsFromEnv(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Whether a user can access admin-only tools. */
export function isAdminUser(
  user: Pick<Doc<"users">, "email" | "isAdmin">
): boolean {
  if (user.isAdmin === true) {
    return true;
  }

  const email = user.email.trim().toLowerCase();
  if (!email) {
    return false;
  }

  return adminEmailsFromEnv().has(email);
}
