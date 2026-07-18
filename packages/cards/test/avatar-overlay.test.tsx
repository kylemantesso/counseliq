import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  AVATAR_OVERLAY_TEMPLATES,
  AvatarOverlayCard,
  BrandThemeProvider,
  latrobeTheme,
  SETTLED_TIMING,
  type CardTiming,
} from "../index";

const MID: CardTiming = {
  localMs: 800,
  progress: 0.4,
  beatsRevealed: 1.5,
  reducedMotion: false,
};

const CASES: Record<string, Record<string, unknown>> = {
  "title-card": { title: "Assessing financial capacity", kicker: "Module 3" },
  "stat-card": { headline: "Top 1%", supporting: "of universities worldwide" },
  "list-reveal": { heading: "Evidence of funds", items: ["Savings", "Loan", "Scholarship"] },
  "comparison-split": { leftHeading: "City", leftItems: ["A$560"], rightHeading: "Campus", rightItems: ["A$280"] },
  "quote-card": { quote: "A course can open a network.", attribution: "Graduate" },
  "map-card": { region: "Victoria", markers: ["Mildura", "Bendigo"] },
  "timeline-card": { heading: "Student intent", events: [{ date: "2024", label: "Requirement" }] },
  "takeaway-card": { text: "Evidence must be traceable." },
  "pathway-card": { heading: "Three stages", stages: ["ELICOS", "Diploma", "Bachelor"] },
  "persona-card": { name: "Amara", chips: ["Student", "Sponsor"] },
  "alert-card": { message: "Never alter a document." },
  "breakdown-card": { heading: "Evidence", parts: [{ label: "Tuition", value: "A$10,000" }] },
  "myth-fact-card": { myth: "Any test works.", fact: "Use an approved test." },
  "text-card": { heading: "Why it matters", body: "Facilities are facts." },
};

function renderOnce(template: string, props: Record<string, unknown>, timing = MID): string {
  const { container, unmount } = render(
    <BrandThemeProvider theme={latrobeTheme}>
      <AvatarOverlayCard template={template} props={props} timing={timing} />
    </BrandThemeProvider>
  );
  const html = container.innerHTML;
  unmount();
  return html;
}

describe("avatar overlay family", () => {
  test("registers exactly the requested semantic templates", () => {
    expect(AVATAR_OVERLAY_TEMPLATES).toEqual([
      "title-card",
      "stat-card",
      "list-reveal",
      "comparison-split",
      "quote-card",
      "map-card",
      "timeline-card",
      "takeaway-card",
      "pathway-card",
      "persona-card",
      "alert-card",
      "breakdown-card",
      "myth-fact-card",
      "text-card",
    ]);
  });

  for (const template of AVATAR_OVERLAY_TEMPLATES) {
    test(`${template} renders deterministically from props and timing`, () => {
      const first = renderOnce(template, CASES[template]);
      const second = renderOnce(template, CASES[template]);
      expect(first).toContain(`data-ciq-avatar-overlay-card="${template}"`);
      expect(second).toBe(first);
    });
  }

  test("beat-revealed rows are hidden, fractional, and settled solely from timing", () => {
    const props = CASES["list-reveal"];
    const atZero = renderOnce("list-reveal", props, { ...MID, beatsRevealed: 0 });
    const atMid = renderOnce("list-reveal", props, { ...MID, beatsRevealed: 1.5 });
    const settled = renderOnce("list-reveal", props, SETTLED_TIMING);
    expect(atZero).toContain("opacity: 0;");
    expect(atMid).toContain("opacity: 0.875;");
    expect(settled).not.toContain("opacity: 0;");
  });

  test("unknown templates do not render an unintended treatment", () => {
    expect(renderOnce("chart-card", {})).not.toContain("data-ciq-avatar-overlay-card");
  });
});
