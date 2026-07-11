"use client";

import { useMemo } from "react";
import { useRouter } from "solito/navigation";
import { Box, Button, ButtonText, ScrollView, Text } from "@counseliq/ui";
import { CARD_TEMPLATES, type CardTemplate } from "@counseliq/course-schema";
import { AdminGuard } from "../components/admin-guard";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
import { useSelectedInstitution } from "../components/admin/use-selected-institution";
import { CardStaticPreview } from "../components/card-static-preview.web";
import { GoogleBrandFontLoader } from "../components/theme/google-brand-font-loader.web";

const CARD_PREVIEW_TEMPLATES = CARD_TEMPLATES.filter(
  (template) => template !== "video-card"
) as CardTemplate[];

type PreviewQuery = {
  name: string | null;
  market: string | null;
  brandTokens: Record<string, unknown>;
};

export function AdminInstitutionCardPreviewScreen() {
  return (
    <AdminGuard>
      <AdminInstitutionCardPreviewContent />
    </AdminGuard>
  );
}

function AdminInstitutionCardPreviewContent() {
  const router = useRouter();
  const { selectedInstitution } = useSelectedInstitution();
  const previewQuery = useMemo(readPreviewQuery, []);
  const selectedTokens = toRecord(selectedInstitution?.brandTokens);
  const brandTokens =
    Object.keys(previewQuery.brandTokens).length > 0
      ? previewQuery.brandTokens
      : selectedTokens;
  const institutionName =
    previewQuery.name ?? selectedInstitution?.name ?? "Institution";
  const market = previewQuery.market ?? selectedInstitution?.market ?? "AU";

  return (
    <AdminWorkspaceFrame
      activeNav="institutions"
      title={`${institutionName} card preview`}
      description={`Generic sample content rendered with ${institutionName} theme tokens.`}
      topbarTrail={["Workspace", "Institutions", "Card preview"]}
      headerActions={
        <Button variant="outline" onPress={() => router.push("/admin/institutions")}>
          <ButtonText>Back to institution</ButtonText>
        </Button>
      }
    >
      <GoogleBrandFontLoader fontFamily={readString(brandTokens, "fontFamily")} />
      <ScrollView className="flex-1 w-full">
        <Box className="gap-5 pb-8">
          <Box className="flex-row flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
            <Box className="gap-1">
              <Text className="text-sm font-bold text-foreground">
                {CARD_PREVIEW_TEMPLATES.length} card templates
              </Text>
              <Text className="text-xs text-muted-foreground">
                Generic {market} course content. Save institution details to persist these theme tokens.
              </Text>
            </Box>
            <Box className="flex-row flex-wrap gap-2">
              <TokenPill label="Primary" value={readString(brandTokens, "primaryColor") || "default"} />
              <TokenPill label="Secondary" value={readString(brandTokens, "secondaryColor") || "default"} />
              <TokenPill label="Background" value={readString(brandTokens, "backgroundColor") || "default"} />
            </Box>
          </Box>

          <Box
            style={{
              display: "grid",
              gap: 20,
              gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
            } as never}
          >
            {CARD_PREVIEW_TEMPLATES.map((template) => (
              <Box key={template} className="gap-2">
                <Box className="overflow-hidden rounded-2xl border border-border bg-card p-2">
                  <Box style={{ aspectRatio: 9 / 16 } as never}>
                    <CardStaticPreview
                      template={template}
                      props={genericCardProps(template, institutionName, market)}
                      brandTokens={brandTokens}
                      showControls={false}
                    />
                  </Box>
                </Box>
                <Text className="text-center text-xs font-bold text-muted-foreground">
                  {formatTemplateName(template)}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      </ScrollView>
    </AdminWorkspaceFrame>
  );
}

function TokenPill({ label, value }: { label: string; value: string }) {
  return (
    <Box className="rounded-full border border-border bg-background px-3 py-1">
      <Text className="text-xs font-bold text-secondary-foreground">
        {label}: {value}
      </Text>
    </Box>
  );
}

function readPreviewQuery(): PreviewQuery {
  if (typeof window === "undefined") {
    return { name: null, market: null, brandTokens: {} };
  }
  const params = new URLSearchParams(window.location.search);
  const brandTokens: Record<string, unknown> = {};
  copyStringParam(params, brandTokens, "primaryColor");
  copyStringParam(params, brandTokens, "secondaryColor");
  copyStringParam(params, brandTokens, "backgroundColor");
  copyStringParam(params, brandTokens, "logoUrl");
  copyStringParam(params, brandTokens, "fontFamily");
  copyStringParam(params, brandTokens, "titleCase");
  const placeholder = params.get("placeholder");
  if (placeholder === "1") brandTokens.placeholder = true;
  if (placeholder === "0") brandTokens.placeholder = false;
  return {
    name: cleanParam(params.get("name")),
    market: cleanParam(params.get("market")),
    brandTokens,
  };
}

function copyStringParam(
  params: URLSearchParams,
  target: Record<string, unknown>,
  key: string
) {
  const value = cleanParam(params.get(key));
  if (value) target[key] = value;
}

function cleanParam(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(tokens: Record<string, unknown>, key: string): string | null {
  const value = tokens[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatTemplateName(template: CardTemplate): string {
  return template
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function genericCardProps(
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
