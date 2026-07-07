import { CARD_PROP_FIXTURES } from "@counseliq/course-schema";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ReactNode } from "react";
import { AssetResolverContext, type AssetResolver } from "../src/assets";
import { ChartCard } from "../src/templates/chart-card";
import { ImageTextCard } from "../src/templates/image-text-card";
import { MapCard } from "../src/templates/map-card";
import { PhotoKenburnsCard } from "../src/templates/photo-kenburns";
import { BrandThemeProvider } from "../src/theme/brand-theme-provider";
import { SETTLED_TIMING, type CardTiming } from "../src/timing";

/** A5 image/graphic templates: photo-kenburns, image-text-card, map-card, chart-card. */

const ZERO: CardTiming = { localMs: 0, progress: 0, beatsRevealed: 0, reducedMotion: false };
const MID: CardTiming = { localMs: 800, progress: 0.4, beatsRevealed: 1.5, reducedMotion: false };

const fixtures = CARD_PROP_FIXTURES as Record<string, Record<string, unknown>>;

function renderCard(node: ReactNode, resolver?: AssetResolver) {
  const themed = <BrandThemeProvider>{node}</BrandThemeProvider>;
  return render(
    resolver ? (
      <AssetResolverContext.Provider value={resolver}>{themed}</AssetResolverContext.Provider>
    ) : (
      themed
    )
  );
}

function renderOnceHtml(node: ReactNode): string {
  const { container, unmount } = renderCard(node);
  const html = container.innerHTML;
  unmount();
  return html;
}

describe("photo-kenburns", () => {
  const props = fixtures["photo-kenburns"] as never;

  test("settled render shows overlay text over the placeholder", () => {
    const { container } = renderCard(<PhotoKenburnsCard props={props} timing={SETTLED_TIMING} />);
    expect(container.textContent).toContain("Clinical training, on campus and in community");
    expect(container.querySelector("[data-ciq-image-placeholder]")).not.toBeNull();
  });

  test("pan transform differs between progress 0 and 1", () => {
    const at = (progress: number) => {
      const { container, unmount } = renderCard(
        <PhotoKenburnsCard props={props} timing={{ ...ZERO, progress }} />
      );
      const transform = (container.querySelector("[data-ciq-pan]") as HTMLElement).style.transform;
      unmount();
      return transform;
    };
    const start = at(0);
    const end = at(1);
    expect(start).not.toBe(end);
    expect(end).toContain("scale(1.12)");
  });

  test("reduced motion holds a static frame with no drift offset at any progress", () => {
    const at = (progress: number) => {
      const { container, unmount } = renderCard(
        <PhotoKenburnsCard props={props} timing={{ ...ZERO, progress, reducedMotion: true }} />
      );
      const transform = (container.querySelector("[data-ciq-pan]") as HTMLElement).style.transform;
      unmount();
      return transform;
    };
    expect(at(0)).toBe("scale(1.12)");
    expect(at(0.5)).toBe("scale(1.12)");
    expect(at(1)).toBe("scale(1.12)");
  });

  test("resolved imageRef renders an img instead of the placeholder", () => {
    const resolver: AssetResolver = { resolve: () => "https://example.test/photo.jpg" };
    const { container } = renderCard(<PhotoKenburnsCard props={props} timing={SETTLED_TIMING} />, resolver);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.test/photo.jpg");
    expect(container.querySelector("[data-ciq-image-placeholder]")).toBeNull();
  });
});

describe("image-text-card", () => {
  const props = fixtures["image-text-card"] as never;

  test("settled render shows the text and the unresolved-image placeholder", () => {
    const { container } = renderCard(<ImageTextCard props={props} timing={SETTLED_TIMING} />);
    expect(container.textContent).toContain("largest regional campus");
    expect(container.querySelector("[data-ciq-image-placeholder]")).not.toBeNull();
  });

  test("optional passthrough kicker/title render when present", () => {
    const withHeadings = { ...(props as Record<string, unknown>), kicker: "Regional campus", title: "Bendigo" };
    const { container } = renderCard(<ImageTextCard props={withHeadings as never} timing={SETTLED_TIMING} />);
    expect(container.textContent).toContain("Regional campus");
    expect(container.textContent).toContain("Bendigo");
  });
});

describe("map-card", () => {
  const props = fixtures["map-card"] as never;

  test("settled render shows region, all markers, and caption", () => {
    const { container } = renderCard(<MapCard props={props} timing={SETTLED_TIMING} />);
    expect(container.textContent).toContain("Victoria & southern NSW");
    for (const marker of (props as { markers: string[] }).markers) {
      expect(container.textContent).toContain(marker);
    }
    expect(container.textContent).toContain("Rural Medical Pathway Program campuses");
  });

  test("markers are hidden at beatsRevealed 0 and fully shown at Infinity", () => {
    const opacityAt = (timing: CardTiming) => {
      const { container, unmount } = renderCard(<MapCard props={props} timing={timing} />);
      const first = container.querySelector("[data-ciq-map-marker]") as HTMLElement;
      const opacity = first.style.opacity;
      unmount();
      return opacity;
    };
    expect(opacityAt(ZERO)).toBe("0");
    expect(opacityAt({ ...ZERO, beatsRevealed: Number.POSITIVE_INFINITY })).toBe("");
  });
});

describe("chart-card", () => {
  const props = fixtures["chart-card"] as never;

  test("settled render shows heading, labels, verbatim string values, and sourceLabel", () => {
    const { container } = renderCard(<ChartCard props={props} timing={SETTLED_TIMING} />);
    expect(container.textContent).toContain("Median weekly rent");
    expect(container.textContent).toContain("Melbourne");
    expect(container.textContent).toContain("A$560");
    expect(container.textContent).toContain("A$280");
    expect(container.textContent).toContain("La Trobe Study Guide 2025");
  });

  test("bars are collapsed at beatsRevealed 0 and settled at Infinity", () => {
    const barTransforms = (timing: CardTiming) => {
      const { container, unmount } = renderCard(<ChartCard props={props} timing={timing} />);
      const bars = Array.from(container.querySelectorAll("[data-ciq-chart-bar]")).map(
        (bar) => (bar.lastElementChild as HTMLElement).style.transform
      );
      unmount();
      return bars;
    };
    for (const transform of barTransforms(ZERO)) expect(transform).toBe("scaleX(0)");
    for (const transform of barTransforms({ ...ZERO, beatsRevealed: Number.POSITIVE_INFINITY })) {
      expect(transform).toBe("");
    }
  });

  test("bar widths are proportional to parsed numeric values", () => {
    const { container } = renderCard(<ChartCard props={props} timing={SETTLED_TIMING} />);
    const widths = Array.from(container.querySelectorAll("[data-ciq-chart-bar]")).map(
      (bar) => parseFloat((bar.lastElementChild as HTMLElement).style.width)
    );
    // Fixture: A$560, A$455, A$280 — max is first, half is last.
    expect(widths[0]).toBe(100);
    expect(widths[1]).toBeCloseTo((455 / 560) * 100, 1);
    expect(widths[2]).toBeCloseTo(50, 1);
  });

  test("non-numeric values fall back to a minimal bar without throwing", () => {
    const odd = { series: [{ label: "Unknown", value: "n/a" }, { label: "Known", value: 10 }] };
    const { container } = renderCard(<ChartCard props={odd as never} timing={SETTLED_TIMING} />);
    const first = container.querySelector("[data-ciq-chart-bar]")?.lastElementChild as HTMLElement;
    expect(first.style.width).toBe("6%");
  });
});

describe("A5 determinism", () => {
  const cases = [
    ["photo-kenburns", PhotoKenburnsCard],
    ["image-text-card", ImageTextCard],
    ["map-card", MapCard],
    ["chart-card", ChartCard],
  ] as const;

  for (const [name, Component] of cases) {
    test(`${name} renders identically twice at mid timing`, () => {
      const props = fixtures[name] as never;
      const first = renderOnceHtml(<Component props={props} timing={MID} />);
      const second = renderOnceHtml(<Component props={props} timing={MID} />);
      expect(first.length).toBeGreaterThan(0);
      expect(second).toBe(first);
    });
  }
});
