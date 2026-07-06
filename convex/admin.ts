import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getUserForIdentity } from "./auth";
import { isAdminUser } from "./adminAccess";
import { AppErrorCode, appError } from "./errors";

export { isAdminUser } from "./adminAccess";

export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await getUserForIdentity(ctx);
  if (!user) {
    appError(AppErrorCode.UNAUTHORIZED);
  }

  if (!isAdminUser(user)) {
    appError(AppErrorCode.ADMIN_FORBIDDEN);
  }

  return user;
}
