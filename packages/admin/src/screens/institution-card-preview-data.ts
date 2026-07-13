import { CARD_TEMPLATES, type CardTemplate } from "@counseliq/course-schema";

export const CARD_PREVIEW_TEMPLATES = CARD_TEMPLATES.filter(
  (template) => template !== "video-card"
) as CardTemplate[];

export function formatTemplateName(template: CardTemplate): string {
  return template
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function genericInstitutionCardProps(
  template: CardTemplate,
  institutionName: string,
  market: string
): Record<string, unknown> {
  switch (template) {
    case "title-card":
      return {
        kicker: "THEME PREVIEW",
        title: `Welcome to ${institutionName}`,
        courseLabel: "Generic course sample",
      };
    case "stat-card":
      return {
        headline: "87%",
        supporting: "of learners chose a next step after this module",
        sourceLabel: "Generic learner insight",
      };
    case "list-reveal":
      return {
        heading: "What this preview checks",
        items: [
          { text: "Brand colours on headings and rules" },
          { text: "Typography across dense layouts" },
          { text: "Contrast on light and dark surfaces" },
        ],
      };
    case "comparison-split":
      return {
        leftHeading: "Student goals",
        leftItems: ["Career clarity", "Entry requirements", "Campus fit"],
        rightHeading: "Course signals",
        rightItems: ["Outcomes", "Evidence", "Next action"],
      };
    case "quote-card":
      return {
        quote:
          "The right course story connects student intent with evidence they can verify.",
        attribution: "Generic counsellor note",
        sourceLabel: "Sample content",
      };
    case "map-card":
      return {
        region: `${market} study network`,
        markers: ["Main campus", "City centre", "Regional hub", "Online"],
        highlight: ["Main campus", "Online"],
        caption: "Sample delivery locations",
      };
    case "timeline-card":
      return {
        heading: "From interest to decision",
        events: [
          { date: "Step 1", label: "Clarify the goal", detail: "Capture motivation and context" },
          { date: "Step 2", label: "Match the evidence", detail: "Connect claims to sources" },
          { date: "Step 3", label: "Choose the pathway", detail: "Confirm fit and next action" },
        ],
      };
    case "document-callout":
      return {
        title: "Evidence to cite",
        excerpt: "Course handbook · entry requirements · intake dates · career outcomes",
        sourceLabel: "Generic source pack",
      };
    case "photo-kenburns":
      return {
        overlayText: `${institutionName} learning environment`,
        panDirection: "in",
      };
    case "takeaway-card":
      return {
        text: "A strong recommendation uses specific evidence, clear fit, and a practical next step.",
      };
    case "pathway-card":
      return {
        heading: "Decision pathway",
        stages: ["Intent", "Evidence", "Fit", "Action"],
        note: "Use the same sequence across every recommendation",
      };
    case "persona-card":
      return {
        name: "Maya, 22",
        location: `${market} applicant`,
        chips: ["Career changer", "Needs flexible study", "Comparing pathways"],
        footerPrompt: "Which evidence should lead?",
      };
    case "alert-card":
      return {
        message:
          "Keep claims attributable. If a student sees a superlative, show where it came from.",
      };
    case "breakdown-card":
      return {
        heading: "Recommendation inputs",
        parts: [
          { label: "Goal", value: "Career shift" },
          { label: "Mode", value: "Flexible" },
          { label: "Evidence", value: "3 sources" },
        ],
      };
    case "myth-fact-card":
      return {
        myth: "A popular course is automatically the best fit",
        fact: "A fit depends on goals, constraints, evidence, and outcomes",
      };
    case "text-card":
      return {
        heading: "Why this matters",
        body: "Students need a recommendation they can explain in their own words and support with verifiable details.",
      };
    case "term-card":
      return {
        term: "Course fit",
        definition:
          "The overlap between a learner's goal, available evidence, entry requirements, and practical constraints.",
      };
    case "image-text-card":
      return {
        text: `${institutionName} sample card combining an image area with a concise evidence statement.`,
      };
    case "chart-card":
      return {
        heading: "Priority signals",
        series: [
          { label: "Outcome clarity", value: 82 },
          { label: "Evidence strength", value: 76 },
          { label: "Student confidence", value: 68 },
        ],
        sourceLabel: "Generic preview dataset",
      };
    case "date-card":
      return {
        date: "15 October 2026",
        label: "Sample application checkpoint",
      };
    case "checklist-card":
      return {
        heading: "Before publishing",
        items: [
          "Review contrast",
          "Confirm logo fit",
          "Check long headings",
          "Validate source labels",
        ],
      };
    case "video-card":
      return {
        assetRef: "asset:demo:generic-video",
        overlayText: `${institutionName} video preview`,
        sourceLabel: "Generic media",
      };
  }
}
