import { v } from "convex/values";
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Read the single appConfig row, if it exists. The table is treated as a
 * singleton — we never expect more than one row, so we just take the first.
 */
async function getConfig(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"appConfig"> | null> {
  return ctx.db.query("appConfig").first();
}

/**
 * Public, unauthenticated query powering the native force-upgrade gate. Runs
 * on app boot before (and regardless of) login, so it must never require an
 * identity. Returns the minimum supported version per platform; `null` for a
 * platform means "no minimum enforced".
 */
export const getRequiredVersions = query({
  args: {},
  handler: async (ctx) => {
    const config = await getConfig(ctx);
    return {
      ios: config?.minimumVersionIos ?? null,
      android: config?.minimumVersionAndroid ?? null,
    };
  },
});

/**
 * Set the minimum supported version per platform. Internal-only: call from the
 * Convex dashboard or CLI (it never goes through the public API), so there is
 * no risk of a client bumping the floor and locking everyone out. Pass a
 * platform value to update it; omit a field to leave it unchanged.
 */
export const setMinimumVersions = internalMutation({
  args: {
    ios: v.optional(v.string()),
    android: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await getConfig(ctx);
    const now = Date.now();

    if (!existing) {
      await ctx.db.insert("appConfig", {
        minimumVersionIos: args.ios,
        minimumVersionAndroid: args.android,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.patch(existing._id, {
      ...(args.ios !== undefined ? { minimumVersionIos: args.ios } : {}),
      ...(args.android !== undefined
        ? { minimumVersionAndroid: args.android }
        : {}),
      updatedAt: now,
    });
  },
});
