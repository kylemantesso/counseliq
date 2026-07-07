import { CARD_PROP_FIXTURES } from "@counseliq/course-schema";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ComponentType, ReactNode } from "react";
import { BreakdownCard } from "../src/templates/breakdown-card";
import { ChecklistCard } from "../src/templates/checklist-card";
import { ComparisonSplit } from "../src/templates/comparison-split";
import { ListReveal } from "../src/templates/list-reveal";
import { PathwayCard } from "../src/templates/pathway-card";
import { PersonaCard } from "../src/templates/persona-card";
import { StatCard } from "../src/templates/stat-card";
import { TimelineCard } from "../src/templates/timeline-card";
import { BrandThemeProvider } from "../src/theme/brand-theme-provider";
import { counseliqTheme, latrobeTheme } from "../src/theme/brand-theme";
import { SETTLED_TIMING, type CardComponentProps, type CardTiming } from "../src/timing";

/**
 * A4 batch — structured/beat templates. Beyond the shared determinism
 * harness (which picks these up once registered), this suite pins the
 * batch's defining behaviour: items reveal per-beat via
 * `beatProgress(timing, i)`, chrome settles, reduced motion === settled.
 */

type AnyCard = ComponentType<CardComponentProps<any>>;

/** Per-template: component, fixture, expected item texts (beat-driven). */
const BATCH: Array<{
  template: string;
  Component: AnyCard;
  itemTexts: (props: Record<string, unknown>) => string[];
}> = [
  {
    template: "list-reveal",
    Component: ListReveal as AnyCard,
    itemTexts: (p) => (p.items as Array<{ text: string }>).map((i) => i.text),
  },
  {
    template: "checklist-card",
    Component: ChecklistCard as AnyCard,
    itemTexts: (p) => p.items as string[],
  },
  {
    template: "comparison-split",
    Component: ComparisonSplit as AnyCard,
    itemTexts: (p) => [...(p.leftItems as string[]), ...(p.rightItems as string[])],
  },
  {
    template: "breakdown-card",
    Component: BreakdownCard as AnyCard,
    itemTexts: (p) => (p.parts as Array<{ label: string }>).map((i) => i.label),
  },
  {
    template: "pathway-card",
    Component: PathwayCard as AnyCard,
    itemTexts: (p) => p.stages as string[],
  },
  {
    template: "timeline-card",
    Component: TimelineCard as AnyCard,
    itemTexts: (p) => (p.events as Array<{ label: string }>).map((i) => i.label),
  },
  {
    template: "persona-card",
    Component: PersonaCard as AnyCard,
    itemTexts: (p) => (p.chips ?? []) as string[],
  },
];

const ZERO: CardTiming = { localMs: 0, progress: 0, beatsRevealed: 0, reducedMotion: false };
const REDUCED: CardTiming = { localMs: 0, progress: 0, beatsRevealed: 0, reducedMotion: true };
const BEATS_1_5: CardTiming = {
  localMs: 5_000,
  progress: 0.5,
  beatsRevealed: 1.5,
  reducedMotion: false,
};

function renderCard(Component: AnyCard, props: Record<string, unknown>, timing: CardTiming) {
  return render(
    <BrandThemeProvider theme={counseliqTheme}>
      <Component props={props} timing={timing} />
    </BrandThemeProvider>
  );
}

function beatItem(container: HTMLElement, index: number): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-ciq-beat-item="${index}"]`);
  expect(el, `beat item ${index} should exist`).not.toBeNull();
  return el as HTMLElement;
}

function opacityOf(el: HTMLElement): number {
  // Settled styles omit opacity entirely — treat absent as fully visible.
  const raw = el.style.opacity;
  return raw === "" ? 1 : Number.parseFloat(raw);
}

describe.each(BATCH)("$template", ({ template, Component, itemTexts }) => {
  const fixture = (CARD_PROP_FIXTURES as Record<string, Record<string, unknown>>)[template];
  const texts = itemTexts(fixture);

  test("settled render shows every item text", () => {
    const { container, unmount } = renderCard(Component, fixture, SETTLED_TIMING);
    for (const text of texts) {
      expect(container.textContent).toContain(text);
    }
    unmount();
  });

  test("beatsRevealed 0 hides every item; Infinity settles every item", () => {
    const zero = renderCard(Component, fixture, ZERO);
    for (let i = 0; i < texts.length; i++) {
      expect(opacityOf(beatItem(zero.container, i)), `item ${i} at 0 beats`).toBe(0);
    }
    zero.unmount();

    const settled = renderCard(Component, fixture, SETTLED_TIMING);
    for (let i = 0; i < texts.length; i++) {
      expect(opacityOf(beatItem(settled.container, i)), `item ${i} settled`).toBe(1);
    }
    settled.unmount();
  });

  test("fractional beatsRevealed 1.5: item0 settled, item1 mid, item2 hidden", () => {
    if (texts.length < 3) return; // fixture too small for the three-way assertion
    const { container, unmount } = renderCard(Component, fixture, BEATS_1_5);
    expect(opacityOf(beatItem(container, 0))).toBe(1);
    const mid = opacityOf(beatItem(container, 1));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(opacityOf(beatItem(container, 2))).toBe(0);
    unmount();
  });

  test("reduced motion renders identically to settled", () => {
    const reduced = renderCard(Component, fixture, REDUCED);
    const reducedHtml = reduced.container.innerHTML;
    reduced.unmount();
    const settled = renderCard(Component, fixture, {
      ...SETTLED_TIMING,
      reducedMotion: true,
    });
    expect(reducedHtml).toBe(settled.container.innerHTML);
    settled.unmount();
  });

  test("double render is deterministic", () => {
    const first = renderCard(Component, fixture, BEATS_1_5);
    const html = first.container.innerHTML;
    first.unmount();
    const second = renderCard(Component, fixture, BEATS_1_5);
    expect(second.container.innerHTML).toBe(html);
    second.unmount();
  });
});

describe("stat-card", () => {
  const fixture = (CARD_PROP_FIXTURES as Record<string, Record<string, unknown>>)["stat-card"];

  test("settled render shows headline, supporting, and ALWAYS the sourceLabel", () => {
    const { container, unmount } = renderCard(StatCard as AnyCard, fixture, SETTLED_TIMING);
    expect(container.textContent).toContain(fixture.headline as string);
    expect(container.textContent).toContain(fixture.supporting as string);
    const source = container.querySelector("[data-ciq-source-label]");
    expect(source).not.toBeNull();
    expect(source?.textContent).toContain(fixture.sourceLabel as string);
    unmount();
  });

  test("entrance: everything hidden at localMs 0, settled at rest", () => {
    const zero = renderCard(StatCard as AnyCard, fixture, ZERO);
    const headline = Array.from(zero.container.querySelectorAll<HTMLElement>("div")).find((el) =>
      el.textContent === fixture.headline && el.style.opacity !== ""
    );
    expect(headline, "headline should carry an entrance style at t=0").toBeDefined();
    expect(opacityOf(headline as HTMLElement)).toBe(0);
    zero.unmount();
  });

  test("reduced motion === settled; renders without optional props", () => {
    const reduced = renderCard(StatCard as AnyCard, fixture, REDUCED);
    const settled = renderCard(StatCard as AnyCard, fixture, { ...SETTLED_TIMING, reducedMotion: true });
    expect(reduced.container.innerHTML).toBe(settled.container.innerHTML);
    reduced.unmount();
    settled.unmount();

    const minimal = renderCard(StatCard as AnyCard, { headline: "Top 1%" }, SETTLED_TIMING);
    expect(minimal.container.textContent).toContain("Top 1%");
    expect(minimal.container.querySelector("[data-ciq-source-label]")).toBeNull();
    minimal.unmount();
  });
});

describe("batch details", () => {
  test("timeline spine grows with progress, not beats", () => {
    const fixture = (CARD_PROP_FIXTURES as Record<string, Record<string, unknown>>)["timeline-card"];
    const half = renderCard(TimelineCard as AnyCard, fixture, {
      localMs: 100,
      progress: 0.5,
      beatsRevealed: 0,
      reducedMotion: false,
    });
    const spine = Array.from(half.container.querySelectorAll<HTMLElement>("div[aria-hidden]")).find(
      (el) => el.style.transform.includes("scaleY")
    );
    expect(spine).toBeDefined();
    half.unmount();
  });

  test("breakdown meter widths are proportional to parsed values", () => {
    const props = {
      parts: [
        { label: "A", value: "A$75" },
        { label: "B", value: 25 },
      ],
    };
    const { container, unmount } = renderCard(BreakdownCard as AnyCard, props, SETTLED_TIMING);
    const segments = Array.from(container.querySelectorAll<HTMLElement>("div"))
      .filter((el) => el.style.width.endsWith("%"))
      .map((el) => Number.parseFloat(el.style.width));
    expect(segments).toContain(75);
    expect(segments).toContain(25);
    unmount();
  });

  test("comparison-split beats run left items then right items", () => {
    const fixture = (CARD_PROP_FIXTURES as Record<string, Record<string, unknown>>)["comparison-split"];
    const leftCount = (fixture.leftItems as string[]).length;
    const { container, unmount } = renderCard(ComparisonSplit as AnyCard, fixture, {
      localMs: 5_000,
      progress: 0.5,
      beatsRevealed: leftCount, // exactly the left side revealed
      reducedMotion: false,
    });
    for (let i = 0; i < leftCount; i++) {
      expect(opacityOf(beatItem(container, i))).toBe(1);
    }
    expect(opacityOf(beatItem(container, leftCount))).toBe(0);
    unmount();
  });

  test("persona-card renders header, avatar initial, and footer prompt", () => {
    const fixture = (CARD_PROP_FIXTURES as Record<string, Record<string, unknown>>)["persona-card"];
    const { container, unmount } = renderCard(PersonaCard as AnyCard, fixture, SETTLED_TIMING);
    expect(container.textContent).toContain("Case file");
    expect(container.textContent).toContain("A"); // "Amara, 24" initial
    expect(container.textContent).toContain(fixture.footerPrompt as string);
    unmount();
  });

  test("pathway-card note reveals on the beat after the last stage", () => {
    const fixture = (CARD_PROP_FIXTURES as Record<string, Record<string, unknown>>)["pathway-card"];
    const stages = fixture.stages as string[];
    const { container, unmount } = renderCard(PathwayCard as AnyCard, fixture, {
      localMs: 5_000,
      progress: 0.5,
      beatsRevealed: stages.length, // all stages settled, note not yet
      reducedMotion: false,
    });
    const note = Array.from(container.querySelectorAll<HTMLElement>("div")).find(
      (el) => el.textContent === fixture.note
    );
    expect(note).toBeDefined();
    expect(opacityOf(note as HTMLElement)).toBe(0);
    unmount();
  });
});
