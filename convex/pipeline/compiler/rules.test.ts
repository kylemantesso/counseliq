import { describe, expect, test } from "vitest";
import {
  cardText,
  findBannedClaimsInText,
  findExcludedFactLeaks,
  findRedundantCards,
  tokenOverlapRatio,
  validateCardProvenance,
  validateGenericCardCap,
  validateQuestionConceptTags,
  validateStatisticCardsHaveSource,
  validateUniqueQuestionPrompts,
  validateAssetRefs,
  validateMediaPacing,
  type CatalogueAssetInfo,
} from "./rules";

describe("banned-claims lexicon", () => {
  test("catches migration-outcome promises", () => {
    const hits = findBannedClaimsInText(
      "Graduates are guaranteed a post-study visa after completing this degree."
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].code).toBe("migration-outcome-promise");
  });

  test("catches 'PR is guaranteed' phrasing", () => {
    const hits = findBannedClaimsInText(
      "For nursing graduates, permanent residency is guaranteed."
    );
    expect(hits.some((h) => h.code === "migration-outcome-promise")).toBe(true);
  });

  test("catches employment guarantees", () => {
    const hits = findBannedClaimsInText(
      "The university guarantees a job within six months of graduation."
    );
    expect(hits.some((h) => h.code === "employment-guarantee")).toBe(true);
  });

  test("warning against promises is legal (negation context)", () => {
    expect(
      findBannedClaimsInText(
        "Never tell a student that permanent residency is guaranteed."
      )
    ).toEqual([]);
    expect(
      findBannedClaimsInText(
        "It is misconduct to say a job is guaranteed after graduation."
      )
    ).toEqual([]);
  });

  test("stating current visa settings is legal", () => {
    expect(
      findBannedClaimsInText(
        "The Temporary Graduate visa currently allows two to four years of post-study work rights."
      )
    ).toEqual([]);
  });

  test("catches unattributed superlatives", () => {
    const hits = findBannedClaimsInText(
      "It is Australia's largest provider of online education."
    );
    expect(hits.some((h) => h.code === "unattributed-superlative")).toBe(true);
  });

  test("attributed superlatives are legal", () => {
    expect(
      findBannedClaimsInText(
        "The university describes itself as Australia's largest provider of online education."
      )
    ).toEqual([]);
  });

  test("ranking attributions are legal", () => {
    expect(
      findBannedClaimsInText(
        "It is ranked in the world's top one percent of universities by ShanghaiRanking."
      )
    ).toEqual([]);
  });

  test("clean text produces no hits", () => {
    expect(
      findBannedClaimsInText(
        "The Burwood campus enrols about thirty thousand students."
      )
    ).toEqual([]);
  });
});

describe("generic-card cap", () => {
  const card = (template: string) => ({ template });

  test("within cap and non-consecutive passes", () => {
    expect(
      validateGenericCardCap([
        card("text-card"),
        card("stat-card"),
        card("map-card"),
      ])
    ).toEqual([]);
  });

  test("exceeding 1-in-3 fails", () => {
    const violations = validateGenericCardCap([
      card("text-card"),
      card("stat-card"),
      card("text-card"),
      card("map-card"),
    ]);
    expect(violations.some((v) => v.includes("cap"))).toBe(true);
  });

  test("consecutive generic cards fail even when the count is within cap", () => {
    const violations = validateGenericCardCap([
      card("text-card"),
      card("text-card"),
      card("stat-card"),
      card("map-card"),
      card("quote-card"),
      card("timeline-card"),
    ]);
    expect(violations.some((v) => v.includes("consecutive"))).toBe(true);
  });
});

describe("card provenance", () => {
  const known = new Set(["doc:abc123:page:2", "doc:abc123:page:3"]);

  test("compiler:derived is always legal", () => {
    expect(
      validateCardProvenance(
        [{ template: "title-card", provenance: "compiler:derived" }],
        known
      )
    ).toEqual([]);
  });

  test("known page IDs (;-joined) are legal", () => {
    expect(
      validateCardProvenance(
        [
          {
            template: "stat-card",
            provenance: "doc:abc123:page:2;doc:abc123:page:3",
          },
        ],
        known
      )
    ).toEqual([]);
  });

  test("malformed provenance fails", () => {
    const violations = validateCardProvenance(
      [{ template: "stat-card", provenance: "page 2" }],
      known
    );
    expect(violations).toHaveLength(1);
  });

  test("unknown page ID fails", () => {
    const violations = validateCardProvenance(
      [{ template: "stat-card", provenance: "doc:zzz999:page:9" }],
      known
    );
    expect(violations.some((v) => v.includes("does not reference"))).toBe(true);
  });
});

describe("statistic cards need a sourceLabel", () => {
  test("stat card without sourceLabel fails", () => {
    expect(
      validateStatisticCardsHaveSource([
        { template: "stat-card", props: { value: "61%" } },
      ])
    ).toHaveLength(1);
  });

  test("stat card with sourceLabel passes; non-stat cards are ignored", () => {
    expect(
      validateStatisticCardsHaveSource([
        {
          template: "stat-card",
          props: { value: "61%", sourceLabel: "QILT GOS 2023" },
        },
        { template: "map-card", props: {} },
      ])
    ).toEqual([]);
  });
});

describe("question checks", () => {
  test("conceptTag mismatch is a violation", () => {
    const violations = validateQuestionConceptTags(
      [{ unitId: "u1", conceptTag: "campuses", questionIds: ["q-u1-h"] }],
      [{ id: "q-u1-h", conceptTag: "rankings" }]
    );
    expect(violations).toHaveLength(1);
  });

  test("duplicate prompts (normalized) are a violation", () => {
    const violations = validateUniqueQuestionPrompts([
      { id: "q-u1-h", prompt: "How many campuses does Deakin have?" },
      { id: "q-u2-h", prompt: "how many campuses does deakin have" },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("q-u2-h");
  });
});

describe("redundancy pre-pass", () => {
  test("token overlap ratio", () => {
    expect(tokenOverlapRatio("five campuses", "There are five campuses")).toBe(1);
    expect(tokenOverlapRatio("something else entirely", "five campuses")).toBe(0);
  });

  test("cardText flattens nested string props", () => {
    expect(
      cardText({ title: "Five", items: [{ label: "campuses" }], n: 5 })
    ).toBe("Five campuses");
  });

  test("a card transcribing its narration sentence is flagged", () => {
    const candidates = findRedundantCards({
      unitId: "u1",
      narration: [
        { id: "n1", text: "Deakin has five campuses across Victoria." },
      ],
      cards: [
        {
          template: "text-card",
          props: { text: "Deakin has five campuses across Victoria." },
          enterAt: { narration: "n1" },
        },
        {
          template: "map-card",
          props: { region: "Melbourne and Geelong locations" },
          enterAt: { narration: "n1" },
        },
      ],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].cardIndex).toBe(0);
    expect(candidates[0].overlap).toBeGreaterThan(0.6);
  });
});

describe("excluded-fact leak", () => {
  test("numeric leak: number plus enough distinctive words", () => {
    const leaks = findExcludedFactLeaks(
      "The university enrols 70,000 students across all campuses.",
      [{ statement: "The university enrols 70,000 students." }]
    );
    expect(leaks).toHaveLength(1);
    expect(leaks[0].matchedTokens).toContain("70000");
  });

  test("same number in a different context does not leak", () => {
    const leaks = findExcludedFactLeaks(
      "Tuition starts at 70,000 dollars for the full degree.",
      [{ statement: "The university enrols 70,000 international students annually." }]
    );
    expect(leaks).toEqual([]);
  });

  test("number-free fact leaks on high word overlap", () => {
    const leaks = findExcludedFactLeaks(
      "The chancellor resigned amid a governance scandal last year.",
      [{ statement: "The chancellor resigned amid a governance scandal." }]
    );
    expect(leaks).toHaveLength(1);
  });

  test("clean course text has no leaks", () => {
    expect(
      findExcludedFactLeaks("Deakin has five campuses across Victoria.", [
        { statement: "The chancellor resigned amid a governance scandal." },
      ])
    ).toEqual([]);
  });
});

// --- M6 media rules ---

describe("validateAssetRefs", () => {
  const CATALOGUE: ReadonlyMap<string, CatalogueAssetInfo> = new Map([
    ["vid1", { kind: "video", aspect: "landscape", cleared: true }],
    ["img1", { kind: "image", aspect: "landscape", cleared: true }],
    ["img2", { kind: "image", aspect: "portrait", cleared: true }],
    ["dirty", { kind: "image", aspect: "landscape", cleared: false }],
  ]);

  const card = (template: string, props: Record<string, unknown> = {}) => ({
    template,
    props,
  });

  test("valid refs pass; cards without refs are ignored", () => {
    expect(
      validateAssetRefs(
        [
          card("video-card", { assetRef: "vid1" }),
          card("photo-kenburns", { assetRef: "img1" }),
          card("photo-kenburns", { assetRef: "img2" }), // portrait OK full-bleed
          card("image-text-card", { assetRef: "img1" }),
          card("stat-card"),
          card("photo-kenburns"), // media template without ref: allowed
          card("list-reveal", { bgAssetRef: "img1", bgTreatment: "faded" }),
          card("takeaway-card", { bgAssetRef: "img2", bgTreatment: "spotlight" }),
        ],
        CATALOGUE
      )
    ).toEqual([]);
  });

  test("dangling id is rejected with never-invent guidance", () => {
    const violations = validateAssetRefs(
      [card("video-card", { assetRef: "made-up" })],
      CATALOGUE
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/not in the cleared asset library/);
  });

  test("uncleared asset is rejected (belt-and-braces leakage gate)", () => {
    const violations = validateAssetRefs(
      [card("photo-kenburns", { assetRef: "dirty" })],
      CATALOGUE
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/not rights-cleared/);
  });

  test("kind mismatches are rejected both ways", () => {
    expect(
      validateAssetRefs([card("video-card", { assetRef: "img1" })], CATALOGUE)[0]
    ).toMatch(
      /requires a video asset/
    );
    expect(
      validateAssetRefs([card("photo-kenburns", { assetRef: "vid1" })], CATALOGUE)[0]
    ).toMatch(/requires an image asset/);
  });

  test("image-text-card rejects portrait images; non-media templates reject refs", () => {
    expect(
      validateAssetRefs([card("image-text-card", { assetRef: "img2" })], CATALOGUE)[0]
    ).toMatch(/cannot frame a portrait image/);
    expect(
      validateAssetRefs([card("stat-card", { assetRef: "img1" })], CATALOGUE)[0]
    ).toMatch(/only valid on media templates/);
  });

  test("bgAssetRef rejects non-image and unsupported templates", () => {
    expect(
      validateAssetRefs([card("stat-card", { bgAssetRef: "vid1" })], CATALOGUE)[0]
    ).toMatch(/bgAssetRef requires an image asset/);
    expect(
      validateAssetRefs([card("quote-card", { bgAssetRef: "img1" })], CATALOGUE)[0]
    ).toMatch(/bgAssetRef is only valid on/);
  });
});

describe("validateMediaPacing", () => {
  const media = (template: string, assetRef = "a1") => ({
    template,
    props: { assetRef },
  });
  const bgMedia = (template: string, bgAssetRef = "a1") => ({
    template,
    props: { bgAssetRef },
  });
  const text = (template: string) => ({ template, props: {} });

  test("empty catalogue disables the rule entirely (unsatisfiable)", () => {
    expect(
      validateMediaPacing(
        [text("text-card"), text("list-reveal"), text("term-card")],
        { images: 0, videos: 0 }
      )
    ).toEqual([]);
  });

  test("1-per-3 cadence: 3+ cards with available media need at least one", () => {
    const cards = [text("stat-card"), text("quote-card"), text("date-card")];
    const violations = validateMediaPacing(cards, { images: 5, videos: 1 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/media pacing: 0 media card/);
  });

  test("cadence scales with card count and is capped by availability", () => {
    const six = [
      media("photo-kenburns"),
      text("stat-card"),
      text("quote-card"),
      text("date-card"),
      text("map-card"),
      text("timeline-card"),
    ];
    // floor(6/3)=2 required, but only 1 asset exists — 1 satisfies.
    expect(validateMediaPacing(six, { images: 1, videos: 0 })).toEqual([]);
    // With 2+ assets, 1 media card in 6 falls short.
    expect(validateMediaPacing(six, { images: 2, videos: 0 })).toHaveLength(1);
  });

  test("two cards never require media", () => {
    expect(
      validateMediaPacing([text("stat-card"), text("quote-card")], {
        images: 9,
        videos: 0,
      })
    ).toEqual([]);
  });

  test("consecutive text-dense cards flagged only while media headroom remains", () => {
    const cards = [
      media("video-card"),
      text("text-card"),
      text("list-reveal"),
    ];
    const withHeadroom = validateMediaPacing(cards, { images: 3, videos: 1 });
    expect(withHeadroom).toHaveLength(1);
    expect(withHeadroom[0]).toMatch(/consecutive text-dense/);
    // Every available asset already used: no consecutive violation.
    expect(validateMediaPacing(cards, { images: 0, videos: 1 })).toEqual([]);
  });

  test("a satisfied unit passes clean", () => {
    expect(
      validateMediaPacing(
        [
          bgMedia("stat-card"),
          media("photo-kenburns"),
          text("list-reveal"),
          media("video-card"),
          text("quote-card"),
          text("date-card"),
        ],
        { images: 4, videos: 2 }
      )
    ).toEqual([]);
  });
});
