import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * Seed an institution to hang walkthrough/eval runs off. Idempotent per
 * name — returns the existing institution if already seeded. Defaults to
 * "Banksia University", a deliberately fictional AU institution (the name
 * appears verbatim in authored narration and cards, so it must read like a
 * real university without colliding with one); eval:compile passes the real
 * institution of the fixture material so authored courses and the QA judge
 * see a consistent brand.
 */
export const seed = internalMutation({
  args: {
    name: v.optional(v.string()),
    /** M5: brand narrator voice — operator-picked provider voice ID. */
    voiceConfig: v.optional(
      v.object({
        provider: v.string(),
        voiceRef: v.string(),
        voiceId: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const name = args.name ?? "Banksia University";
    const existing = await ctx.db.query("institutions").take(100);
    const match = existing.find((institution) => institution.name === name);
    if (match) {
      // Idempotent voice update: operators can attach/replace the voice on
      // an already-seeded institution.
      if (args.voiceConfig) {
        await ctx.db.patch(match._id, { voiceConfig: args.voiceConfig });
      }
      return match._id;
    }

    return await ctx.db.insert("institutions", {
      ...(args.voiceConfig ? { voiceConfig: args.voiceConfig } : {}),
      name,
      brandTokens: {
        placeholder: true,
        primaryColor: "#1a365d",
        secondaryColor: "#c53030",
        titleFontFamily: "system-ui",
        bodyFontFamily: "system-ui",
      },
      pronunciationLexicon: {
        placeholder: true,
      },
      market: "AU",
    });
  },
});
