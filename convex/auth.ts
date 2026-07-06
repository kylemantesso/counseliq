import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AppErrorCode, appError } from "./errors";
import {
  isPlaceholderUserName,
  pickUserDisplayName,
} from "./authIdentity";
import { isAdminUser } from "./adminAccess";

const clerkDisplayNameArg = v.optional(v.string());

type GetOrCreateUserOptions = {
  clerkDisplayName?: string;
};

function buildAuthUser(user: {
  _id: string;
  name: string;
  email: string;
  isAdmin?: boolean;
}) {
  return {
    userId: user._id,
    name: user.name,
    email: user.email,
    isAdmin: isAdminUser(user),
  };
}

export async function getUserForIdentity(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  return await ctx.db
    .query("users")
    .withIndex("by_token_identifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier)
    )
    .first();
}

export async function getOrCreateUserForIdentity(
  ctx: MutationCtx,
  options?: GetOrCreateUserOptions
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    appError(AppErrorCode.UNAUTHORIZED);
  }

  const resolvedName = pickUserDisplayName(
    identity,
    options?.clerkDisplayName
  );

  const existing = await ctx.db
    .query("users")
    .withIndex("by_token_identifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier)
    )
    .first();

  if (existing) {
    if (
      isPlaceholderUserName(existing.name) &&
      !isPlaceholderUserName(resolvedName)
    ) {
      await ctx.db.patch(existing._id, { name: resolvedName });
      return { ...existing, name: resolvedName };
    }
    return existing;
  }

  const userId = await ctx.db.insert("users", {
    tokenIdentifier: identity.tokenIdentifier,
    name: resolvedName,
    email: identity.email ?? "",
    createdAt: Date.now(),
  });

  const user = await ctx.db.get(userId);
  if (!user) {
    appError(AppErrorCode.UNAUTHORIZED);
  }

  return user;
}

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUserForIdentity(ctx);
    if (!user) {
      return null;
    }

    return buildAuthUser(user);
  },
});

/** Create the Convex user row on first sign-in. Idempotent. */
export const ensureUser = mutation({
  args: { clerkDisplayName: clerkDisplayNameArg },
  handler: async (ctx, args) => {
    const user = await getOrCreateUserForIdentity(ctx, {
      clerkDisplayName: args.clerkDisplayName,
    });
    return buildAuthUser(user);
  },
});

/** Backfill display name for OAuth users when JWT claims are empty or stale. */
export const syncAuthProfile = mutation({
  args: { clerkDisplayName: clerkDisplayNameArg },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await getUserForIdentity(ctx);
    if (!user) {
      return null;
    }

    const resolvedName = pickUserDisplayName(
      identity,
      args.clerkDisplayName
    );
    if (
      isPlaceholderUserName(user.name) &&
      !isPlaceholderUserName(resolvedName)
    ) {
      await ctx.db.patch(user._id, { name: resolvedName });
    }

    return null;
  },
});
