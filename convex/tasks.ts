import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { AppErrorCode, appError } from "./errors";
import { getUserForIdentity } from "./auth";

async function requireUserId(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users">> {
  const user = await getUserForIdentity(ctx);
  if (!user) {
    appError(AppErrorCode.UNAUTHORIZED);
  }
  return user._id;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserForIdentity(ctx);
    if (!userId) {
      return [];
    }

    return await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", userId._id))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: { title: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const title = args.title.trim();
    if (!title) {
      appError(AppErrorCode.TASK_TITLE_REQUIRED);
    }

    return await ctx.db.insert("tasks", {
      userId,
      title,
      done: false,
      createdAt: Date.now(),
    });
  },
});

export const toggle = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== userId) {
      appError(AppErrorCode.TASK_NOT_FOUND);
    }

    await ctx.db.patch(args.taskId, { done: !task.done });
    return !task.done;
  },
});

export const remove = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== userId) {
      appError(AppErrorCode.TASK_NOT_FOUND);
    }

    await ctx.db.delete(args.taskId);
  },
});
