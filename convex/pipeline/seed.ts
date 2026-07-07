import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * Seed an institution to hang walkthrough/eval runs off. Idempotent per
 * name — returns the existing institution if already seeded. Defaults to
 * the M1 placeholder "Example University"; eval:compile passes the real
 * institution of the fixture material so authored courses and the QA judge
 * see a consistent brand.
 */
export const seed = internalMutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const name = args.name ?? "Example University";
    const existing = await ctx.db.query("institutions").take(100);
    const match = existing.find((institution) => institution.name === name);
    if (match) {
      return match._id;
    }

    return await ctx.db.insert("institutions", {
      name,
      brandTokens: {
        placeholder: true,
        primaryColor: "#1a365d",
        secondaryColor: "#c53030",
        fontFamily: "system-ui",
      },
      pronunciationLexicon: {
        placeholder: true,
      },
      market: "AU",
    });
  },
});
