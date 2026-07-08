import { z } from "zod";
import { CARD_TEMPLATES, cardTemplateSchema, type CardTemplate } from "./course-definition";

/**
 * Per-template card prop schemas — the M5 cards-track contract.
 *
 * Design rules:
 * - `.passthrough()` everywhere: existing compiled courses were authored
 *   against the prose manifest in author-unit@1 and may carry variant keys
 *   (e.g. stat-card `verificationRequired`); unknown keys must survive.
 * - Optional-heavy: a field is required only when a template cannot render
 *   without it (stat-card.headline, takeaway-card.text, …).
 * - The authoritative prop spec is the "Card template manifest" table in
 *   convex/pipeline/prompts/author-unit@1.md; shapes here follow it plus
 *   the golden fixture's real usage.
 *
 * `courseDefinitionSchema` deliberately does NOT enforce these (cards stay an
 * open record there): review UIs call `validateCardProps` for soft
 * validation chips, and the compiler wire schema enforces them on newly
 * authored units via its retry loop.
 */

const sourceLabel = z.string().min(1).optional();

const listRevealItemSchema = z
  .object({
    text: z.string().min(1),
    sourceLabel,
  })
  .passthrough();

const timelineEventSchema = z
  .object({
    label: z.string().min(1),
    date: z.string().min(1).optional(),
    detail: z.string().min(1).optional(),
  })
  .passthrough();

const labelValueSchema = z
  .object({
    label: z.string().min(1),
    value: z.union([z.string().min(1), z.number()]),
  })
  .passthrough();

export const CARD_PROP_SCHEMAS = {
  "title-card": z
    .object({
      kicker: z.string().min(1).optional(),
      title: z.string().min(1),
      courseLabel: z.string().min(1).optional(),
    })
    .passthrough(),
  "stat-card": z
    .object({
      headline: z.string().min(1),
      supporting: z.string().min(1).optional(),
      kicker: z.string().min(1).optional(),
      sourceLabel,
    })
    .passthrough(),
  "list-reveal": z
    .object({
      heading: z.string().min(1).optional(),
      items: z.array(listRevealItemSchema).min(1),
    })
    .passthrough(),
  "comparison-split": z
    .object({
      leftHeading: z.string().min(1).optional(),
      leftItems: z.array(z.string().min(1)).min(1),
      rightHeading: z.string().min(1).optional(),
      rightItems: z.array(z.string().min(1)).min(1),
    })
    .passthrough(),
  "quote-card": z
    .object({
      quote: z.string().min(1),
      attribution: z.string().min(1).optional(),
      sourceLabel,
    })
    .passthrough(),
  "map-card": z
    .object({
      region: z.string().min(1).optional(),
      markers: z.array(z.string().min(1)).min(1),
      highlight: z.array(z.string().min(1)).optional(),
      caption: z.string().min(1).optional(),
    })
    .passthrough(),
  "timeline-card": z
    .object({
      heading: z.string().min(1).optional(),
      events: z.array(timelineEventSchema).min(1),
    })
    .passthrough(),
  "document-callout": z
    .object({
      title: z.string().min(1),
      excerpt: z.string().min(1).optional(),
      sourceLabel,
    })
    .passthrough(),
  "photo-kenburns": z
    .object({
      /** Catalogue asset id (M6). */
      assetRef: z.string().min(1).optional(),
      /** Deprecated loose ref — pre-M6 fixtures/courses only; assetRef wins. */
      imageRef: z.string().min(1).optional(),
      overlayText: z.string().min(1).optional(),
      panDirection: z.string().min(1).optional(),
    })
    .passthrough(),
  "takeaway-card": z
    .object({
      text: z.string().min(1),
    })
    .passthrough(),
  "pathway-card": z
    .object({
      heading: z.string().min(1).optional(),
      stages: z.array(z.string().min(1)).min(1),
      note: z.string().min(1).optional(),
    })
    .passthrough(),
  "persona-card": z
    .object({
      name: z.string().min(1),
      location: z.string().min(1).optional(),
      chips: z.array(z.string().min(1)).optional(),
      footerPrompt: z.string().min(1).optional(),
    })
    .passthrough(),
  "alert-card": z
    .object({
      message: z.string().min(1),
    })
    .passthrough(),
  "breakdown-card": z
    .object({
      heading: z.string().min(1).optional(),
      parts: z.array(labelValueSchema).min(1),
    })
    .passthrough(),
  "myth-fact-card": z
    .object({
      myth: z.string().min(1),
      fact: z.string().min(1),
    })
    .passthrough(),
  "text-card": z
    .object({
      heading: z.string().min(1).optional(),
      body: z.string().min(1),
    })
    .passthrough(),
  "term-card": z
    .object({
      term: z.string().min(1),
      definition: z.string().min(1),
    })
    .passthrough(),
  "image-text-card": z
    .object({
      /** Catalogue asset id (M6). */
      assetRef: z.string().min(1).optional(),
      /** Deprecated loose ref — pre-M6 fixtures/courses only; assetRef wins. */
      imageRef: z.string().min(1).optional(),
      text: z.string().min(1),
    })
    .passthrough(),
  "chart-card": z
    .object({
      heading: z.string().min(1).optional(),
      series: z.array(labelValueSchema).min(1),
      sourceLabel,
    })
    .passthrough(),
  "date-card": z
    .object({
      date: z.string().min(1),
      label: z.string().min(1).optional(),
    })
    .passthrough(),
  "checklist-card": z
    .object({
      heading: z.string().min(1).optional(),
      items: z.array(z.string().min(1)).min(1),
    })
    .passthrough(),
  "video-card": z
    .object({
      /** Catalogue asset id — required; a video-card cannot render without one. */
      assetRef: z.string().min(1),
      overlayText: z.string().min(1).optional(),
      sourceLabel,
    })
    .passthrough(),
} as const satisfies Record<CardTemplate, z.ZodTypeAny>;

function member<T extends CardTemplate>(template: T) {
  return z
    .object({
      template: z.literal(template),
      props: CARD_PROP_SCHEMAS[template],
    })
    .passthrough();
}

/** Typed `{template, props}` pair — the per-template discriminated union. */
export const typedCardContentSchema = z.discriminatedUnion("template", [
  member("title-card"),
  member("stat-card"),
  member("list-reveal"),
  member("comparison-split"),
  member("quote-card"),
  member("map-card"),
  member("timeline-card"),
  member("document-callout"),
  member("photo-kenburns"),
  member("takeaway-card"),
  member("pathway-card"),
  member("persona-card"),
  member("alert-card"),
  member("breakdown-card"),
  member("myth-fact-card"),
  member("text-card"),
  member("term-card"),
  member("image-text-card"),
  member("chart-card"),
  member("date-card"),
  member("checklist-card"),
  member("video-card"),
]);

export type TypedCardContent = z.infer<typeof typedCardContentSchema>;
export type CardPropsFor<T extends CardTemplate> = z.infer<(typeof CARD_PROP_SCHEMAS)[T]>;

/**
 * Soft-validate card props against the template's schema.
 * Never throws; returns [] when valid. Unknown templates yield one issue.
 */
export function validateCardProps(template: string, props: unknown): z.ZodIssue[] {
  const parsed = cardTemplateSchema.safeParse(template);
  if (!parsed.success) {
    return [
      {
        code: z.ZodIssueCode.custom,
        path: ["template"],
        message: `Unknown card template "${template}" (expected one of: ${CARD_TEMPLATES.join(", ")})`,
      },
    ];
  }
  const result = CARD_PROP_SCHEMAS[parsed.data].safeParse(props);
  return result.success ? [] : result.error.issues;
}
