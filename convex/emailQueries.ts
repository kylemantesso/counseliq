import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getRecipient = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      email: v.string(),
      name: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    const email = user.email.trim();
    if (!email) return null;

    return {
      userId: user._id,
      email,
      name: user.name,
    };
  },
});
