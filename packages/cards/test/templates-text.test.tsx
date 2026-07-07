import { CARD_PROP_SCHEMAS, CARD_PROP_FIXTURES } from "@counseliq/course-schema";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { BrandThemeProvider } from "../src/theme/brand-theme-provider";
import { counseliqTheme } from "../src/theme/brand-theme";
import { SETTLED_TIMING, type CardComponentProps, type CardTiming } from "../src/timing";
import { AlertCard } from "../src/templates/alert-card";
import { DateCard } from "../src/templates/date-card";
import { DocumentCallout } from "../src/templates/document-callout";
import { MythFactCard } from "../src/templates/myth-fact-card";
import { QuoteCard } from "../src/templates/quote-card";
import { TakeawayCard } from "../src/templates/takeaway-card";
import { TermCard } from "../src/templates/term-card";
import { TextCard } from "../src/templates/text-card";
import { TitleCard } from "../src/templates/title-card";

/**
 * Batch-1 template tests (text-led cards). Every template renders its
 * course-schema fixture:
 * - settled → key text present, no in-flight opacity:0 elements
 * - zero timing → delayed elements still hidden (opacity: 0)
 * - reduced motion settles instantly regardless of clock
 * - double render is byte-identical (determinism)
 */

const ZERO_TIMING: CardTiming = { localMs: 0, progress: 0, beatsRevealed: 0, reducedMotion: false };
const REDUCED_AT_ZERO: CardTiming = { localMs: 0, progress: 1, beatsRevealed: 0, reducedMotion: true };

interface Case {
  template: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<CardComponentProps<any>>;
  /** Fixture text fragments that must appear in the settled render. */
  expect: string[];
}

const CASES: Case[] = [
  { template: "title-card", Component: TitleCard, expect: ["Why La Trobe for Health", "MODULE 1", "La Trobe Health Portfolio"] },
  { template: "text-card", Component: TextCard, expect: ["Facilities are facts", "Why it matters"] },
  { template: "takeaway-card", Component: TakeawayCard, expect: ["Evidence, not adjectives", "Takeaway"] },
  { template: "term-card", Component: TermCard, expect: ["OSHC", "Overseas Student Health Cover"] },
  { template: "alert-card", Component: AlertCard, expect: ["Superlatives", "Alert"] },
  { template: "quote-card", Component: QuoteCard, expect: ["industry work experience", "Randi, Master of Digital Health graduate"] },
  { template: "date-card", Component: DateCard, expect: ["28 November 2025", "Applications close"] },
  { template: "myth-fact-card", Component: MythFactCard, expect: ["qualifies you to practise clinically", "registration-track courses", "Myth", "Fact"] },
  { template: "document-callout", Component: DocumentCallout, expect: ["Spot the anomaly", "Cash deposit", "Synthetic document"] },
];

function renderOnce(node: ReactNode): string {
  const { container, unmount } = render(
    <BrandThemeProvider theme={counseliqTheme}>{node}</BrandThemeProvider>
  );
  const html = container.innerHTML;
  unmount();
  return html;
}

describe.each(CASES)("$template", ({ template, Component, expect: expected }) => {
  const props = CARD_PROP_SCHEMAS[template as keyof typeof CARD_PROP_SCHEMAS].parse(
    CARD_PROP_FIXTURES[template as keyof typeof CARD_PROP_FIXTURES]
  );

  test("settled render shows key content with nothing left hidden", () => {
    const html = renderOnce(<Component props={props} timing={SETTLED_TIMING} />);
    for (const fragment of expected) {
      expect(html).toContain(fragment);
    }
    expect(html).not.toContain("opacity: 0;");
  });

  test("zero timing keeps delayed elements hidden", () => {
    const html = renderOnce(<Component props={props} timing={ZERO_TIMING} />);
    expect(html).toContain("opacity: 0;");
  });

  test("reduced motion settles instantly regardless of clock", () => {
    const atZero = renderOnce(<Component props={props} timing={REDUCED_AT_ZERO} />);
    const settled = renderOnce(<Component props={props} timing={SETTLED_TIMING} />);
    expect(atZero).toBe(settled);
  });

  test("double render is deterministic at every timing point", () => {
    for (const timing of [ZERO_TIMING, { localMs: 800, progress: 0.4, beatsRevealed: 1.5, reducedMotion: false }, SETTLED_TIMING]) {
      const a = renderOnce(<Component props={props} timing={timing} />);
      const b = renderOnce(<Component props={props} timing={timing} />);
      expect(a).toBe(b);
    }
  });
});

describe("graceful degradation", () => {
  test("title-card renders without optional kicker/courseLabel", () => {
    const html = renderOnce(<TitleCard props={{ title: "Bare title" }} timing={SETTLED_TIMING} />);
    expect(html).toContain("Bare title");
  });

  test("quote-card renders without attribution", () => {
    const html = renderOnce(<QuoteCard props={{ quote: "Just a quote." }} timing={SETTLED_TIMING} />);
    expect(html).toContain("Just a quote.");
  });

  test("document-callout renders without excerpt or sourceLabel", () => {
    const html = renderOnce(<DocumentCallout props={{ title: "Doc title" }} timing={SETTLED_TIMING} />);
    expect(html).toContain("Doc title");
  });

  test("text-card renders without heading", () => {
    const html = renderOnce(<TextCard props={{ body: "Body only." }} timing={SETTLED_TIMING} />);
    expect(html).toContain("Body only.");
  });

  test("date-card renders without label", () => {
    const html = renderOnce(<DateCard props={{ date: "1 July 2026" }} timing={SETTLED_TIMING} />);
    expect(html).toContain("1 July 2026");
  });

  test("term-card scales long terms down to fit the column", () => {
    const short = renderOnce(<TermCard props={{ term: "OSHC", definition: "d" }} timing={SETTLED_TIMING} />);
    const long = renderOnce(
      <TermCard props={{ term: "Genuine Student requirement", definition: "d" }} timing={SETTLED_TIMING} />
    );
    expect(short).toContain("font-size: 92px");
    // Width-aware fit: "requirement" (11 chars) -> floor(300/(0.58*11)) = 47px.
    expect(long).toContain("font-size: 47px");
  });
});
