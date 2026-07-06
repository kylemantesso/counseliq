import { internalMutation } from "../_generated/server";

/**
 * M1 seed: one institution to hang walkthrough runs off. Idempotent — returns
 * the existing "Example University" if it has already been seeded.
 */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("institutions").take(100);
    const match = existing.find(
      (institution) => institution.name === "Example University"
    );
    if (match) {
      return match._id;
    }

    return await ctx.db.insert("institutions", {
      name: "Example University",
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
