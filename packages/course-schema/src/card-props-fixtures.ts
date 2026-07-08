import type { CardTemplate } from "./course-definition";

/**
 * One realistic props example per card template — content ported from the
 * golden fixture and the design mockups (design/CounselIQ Card
 * Templates.dc.html). Shared by schema tests, @counseliq/cards component
 * tests, and the dev gallery.
 */
export const CARD_PROP_FIXTURES: Record<CardTemplate, Record<string, unknown>> = {
  "title-card": {
    kicker: "MODULE 1",
    title: "Why La Trobe for Health",
    courseLabel: "La Trobe Health Portfolio",
  },
  "stat-card": {
    headline: "42nd",
    supporting: "in the world for nursing",
    sourceLabel: "QS 2024 by Subject",
  },
  "list-reveal": {
    heading: "The health portfolio",
    items: [
      { text: "Top 175 — Medical & Health", sourceLabel: "THE 2024 / CSIC" },
      { text: "Top 150 — Public Health", sourceLabel: "ShanghaiRanking 2024" },
      { text: "Australia's largest Rural Health School" },
    ],
  },
  "comparison-split": {
    leftHeading: "Registration-track",
    leftItems: ["Nursing", "Midwifery", "Occupational Therapy"],
    rightHeading: "Non-registration",
    rightItems: ["Public Health", "Health Information Mgmt", "Health Administration"],
  },
  "quote-card": {
    quote:
      "La Trobe's industry work experience opportunities are really good pathways for students to develop their employability skills along with their studies.",
    attribution: "Randi, Master of Digital Health graduate",
    sourceLabel: "La Trobe master slides",
  },
  "map-card": {
    region: "Victoria & southern NSW",
    markers: ["Melbourne (Bundoora)", "Bendigo", "Albury-Wodonga", "Shepparton", "Mildura"],
    highlight: ["Bendigo", "Albury-Wodonga"],
    caption: "Rural Medical Pathway Program campuses",
  },
  "timeline-card": {
    heading: "How student intent is assessed",
    events: [
      { date: "Pre-2024", label: "GTE statement", detail: "a free-form written essay" },
      { date: "Mar 2024", label: "Genuine Student requirement", detail: "replaces the GTE test" },
      { date: "Today", label: "In-form targeted questions", detail: "answered inside the visa application" },
    ],
  },
  "document-callout": {
    title: "Spot the anomaly",
    excerpt: "12 MAR — Cash deposit — 31,000.00, four days before visa lodgement",
    sourceLabel: "Synthetic document — training example",
  },
  "photo-kenburns": {
    imageRef: "asset:masterdeck:12:photo",
    overlayText: "Clinical training, on campus and in community",
    panDirection: "in",
  },
  "takeaway-card": {
    text: "Evidence, not adjectives: every ranking you quote carries its source and its year.",
  },
  "pathway-card": {
    heading: "The matching method",
    stages: ["Background", "Career goal", "Registration need", "Course match"],
    note: "In that order, every time",
  },
  "persona-card": {
    name: "Amara, 24",
    location: "Lagos, Nigeria",
    chips: ["BSc Biology", "2 yrs hospital records", "Goal: health systems"],
    footerPrompt: "Which course family fits?",
  },
  "alert-card": {
    message:
      "Superlatives ('world's first', 'Australia's largest') are institution claims. Attribute them — don't assert them as independent fact.",
  },
  "breakdown-card": {
    heading: "What the visa officer needs to see",
    parts: [
      { label: "Living costs", value: "A$29,710" },
      { label: "First-year tuition", value: "A$34,500" },
      { label: "Travel", value: "A$2,500" },
      { label: "OSHC", value: "A$650" },
    ],
  },
  "myth-fact-card": {
    myth: "A health masters qualifies you to practise clinically",
    fact: "Only registration-track courses lead toward professional registration eligibility",
  },
  "text-card": {
    heading: "Why it matters",
    body: "Facilities are facts a student can verify. That makes them ideal material for a genuine student narrative.",
  },
  "term-card": {
    term: "OSHC",
    definition: "Overseas Student Health Cover — mandatory health insurance held for the full visa duration.",
  },
  "image-text-card": {
    imageRef: "asset:masterdeck:18:photo",
    text: "Bendigo — La Trobe's largest regional campus, under two hours from Melbourne by train.",
  },
  "chart-card": {
    heading: "Median weekly rent",
    series: [
      { label: "Melbourne", value: "A$560" },
      { label: "Regional Victoria", value: "A$455" },
      { label: "On-campus · Bundoora", value: "A$280" },
    ],
    sourceLabel: "La Trobe Study Guide 2025",
  },
  "date-card": {
    date: "28 November 2025",
    label: "Applications close — February 2026 intake",
  },
  "checklist-card": {
    heading: "A complete evidence pack",
    items: [
      "Bank statements, 6 months",
      "Source of funds letter",
      "Sponsor declaration",
      "Translation certification",
    ],
  },
  "video-card": {
    assetRef: "asset:demo:clinical-simulation-broll",
    overlayText: "Inside the clinical simulation wards",
    sourceLabel: "University media kit",
  },
};
