import type { ComponentType } from "react";
import type { CardComponentProps } from "../timing";

import { AlertCard } from "./alert-card";
import { BreakdownCard } from "./breakdown-card";
import { ChartCard } from "./chart-card";
import { ChecklistCard } from "./checklist-card";
import { ComparisonSplit } from "./comparison-split";
import { DateCard } from "./date-card";
import { DocumentCallout } from "./document-callout";
import { ImageTextCard } from "./image-text-card";
import { ListReveal } from "./list-reveal";
import { MapCard } from "./map-card";
import { MythFactCard } from "./myth-fact-card";
import { PathwayCard } from "./pathway-card";
import { PersonaCard } from "./persona-card";
import { PhotoKenburnsCard } from "./photo-kenburns";
import { QuoteCard } from "./quote-card";
import { StatCard } from "./stat-card";
import { TakeawayCard } from "./takeaway-card";
import { TermCard } from "./term-card";
import { TextCard } from "./text-card";
import { TimelineCard } from "./timeline-card";
import { TitleCard } from "./title-card";

/**
 * Template name → component registry, covering all 21 CARD_TEMPLATES.
 * CardRenderer falls back for anything absent, and the determinism test
 * iterates this record, so every entry is mechanically covered.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TEMPLATE_COMPONENTS: Record<string, ComponentType<CardComponentProps<any>>> = {
  "alert-card": AlertCard,
  "breakdown-card": BreakdownCard,
  "chart-card": ChartCard,
  "checklist-card": ChecklistCard,
  "comparison-split": ComparisonSplit,
  "date-card": DateCard,
  "document-callout": DocumentCallout,
  "image-text-card": ImageTextCard,
  "list-reveal": ListReveal,
  "map-card": MapCard,
  "myth-fact-card": MythFactCard,
  "pathway-card": PathwayCard,
  "persona-card": PersonaCard,
  "photo-kenburns": PhotoKenburnsCard,
  "quote-card": QuoteCard,
  "stat-card": StatCard,
  "takeaway-card": TakeawayCard,
  "term-card": TermCard,
  "text-card": TextCard,
  "timeline-card": TimelineCard,
  "title-card": TitleCard,
};
