import { CARD_PROP_FIXTURES } from "@counseliq/course-schema";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { FallbackCard } from "../src/fallback-card";
import { CardRenderer } from "../src/card-renderer";
import { TEMPLATE_COMPONENTS } from "../src/templates/registry";
import { BrandThemeProvider } from "../src/theme/brand-theme-provider";
import { latrobeTheme } from "../src/theme/brand-theme";
import { SETTLED_TIMING, type CardTiming } from "../src/timing";
import type { ReactNode } from "react";

/**
 * Determinism harness: same (props, timing, theme) must render the exact
 * same HTML twice. Iterates TEMPLATE_COMPONENTS so every template that
 * lands in A3–A5 is covered without touching this file.
 */

const TIMINGS: Record<string, CardTiming> = {
  zero: { localMs: 0, progress: 0, beatsRevealed: 0, reducedMotion: false },
  mid: { localMs: 800, progress: 0.4, beatsRevealed: 1.5, reducedMotion: false },
  settled: SETTLED_TIMING,
};

function renderOnce(node: ReactNode): string {
  const { container, unmount } = render(<BrandThemeProvider theme={latrobeTheme}>{node}</BrandThemeProvider>);
  const html = container.innerHTML;
  unmount();
  return html;
}

describe("render determinism", () => {
  const templates = Object.keys(TEMPLATE_COMPONENTS);

  for (const template of templates) {
    const props = (CARD_PROP_FIXTURES as Record<string, Record<string, unknown>>)[template];
    for (const [label, timing] of Object.entries(TIMINGS)) {
      test(`${template} @ ${label} renders identically twice`, () => {
        expect(props, `missing CARD_PROP_FIXTURES entry for ${template}`).toBeDefined();
        const first = renderOnce(<CardRenderer template={template} props={props} timing={timing} />);
        const second = renderOnce(<CardRenderer template={template} props={props} timing={timing} />);
        expect(first.length).toBeGreaterThan(0);
        expect(second).toBe(first);
      });
    }
  }

  test("FallbackCard renders identically twice", () => {
    const props = { headline: "82%", supporting: "of things" };
    const first = renderOnce(<FallbackCard template="mystery-card" props={props} />);
    const second = renderOnce(<FallbackCard template="mystery-card" props={props} />);
    expect(second).toBe(first);
  });

  test("unknown template falls back instead of throwing", () => {
    const html = renderOnce(
      <CardRenderer template="not-a-template" props={{ a: 1 }} timing={SETTLED_TIMING} />
    );
    expect(html).toContain("not-a-template");
    expect(html).toContain("No renderer registered");
  });

  test("a throwing template is caught by the error boundary", () => {
    const Boom = () => {
      throw new Error("boom");
    };
    TEMPLATE_COMPONENTS["__boom__"] = Boom;
    try {
      const html = renderOnce(
        <CardRenderer template="__boom__" props={{}} timing={SETTLED_TIMING} />
      );
      expect(html).toContain("failed to render");
    } finally {
      delete TEMPLATE_COMPONENTS["__boom__"];
    }
  });
});
