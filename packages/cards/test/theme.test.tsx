import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  brandThemeFromTokens,
  counseliqTheme,
  latrobeTheme,
} from "../src/theme/brand-theme";
import {
  BrandThemeProvider,
  cssVar,
  themeToCssProperties,
} from "../src/theme/brand-theme-provider";

describe("cssVar / themeToCssProperties", () => {
  test("kebab-cases token names under the --ciq prefix", () => {
    expect(cssVar("accent")).toBe("var(--ciq-accent)");
    expect(cssVar("accentInk")).toBe("var(--ciq-accent-ink)");
    expect(cssVar("interSentenceGapMs" as never)).toContain("--ciq-inter-sentence-gap-ms");
  });

  test("emits every theme token as a custom property", () => {
    const style = themeToCssProperties(latrobeTheme) as Record<string, string>;
    expect(style["--ciq-accent"]).toBe("#E2231A");
    expect(style["--ciq-font-display"]).toContain("Barlow Condensed");
    expect(Object.keys(style)).toHaveLength(Object.keys(latrobeTheme).length);
  });
});

describe("BrandThemeProvider", () => {
  test("sets --ciq-* vars on the wrapping element", () => {
    const { container } = render(
      <BrandThemeProvider theme={latrobeTheme}>
        <span>x</span>
      </BrandThemeProvider>
    );
    const wrapper = container.querySelector("[data-ciq-theme]") as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.style.getPropertyValue("--ciq-accent")).toBe("#E2231A");
    expect(wrapper.style.getPropertyValue("--ciq-bg")).toBe("#FCFBF9");
  });

  test("defaults to the counseliq theme", () => {
    const { container } = render(
      <BrandThemeProvider>
        <span>x</span>
      </BrandThemeProvider>
    );
    const wrapper = container.querySelector("[data-ciq-theme]") as HTMLElement;
    expect(wrapper.style.getPropertyValue("--ciq-accent")).toBe(counseliqTheme.accent);
  });
});

describe("brandThemeFromTokens", () => {
  test("null/garbage falls back to counseliq wholesale", () => {
    expect(brandThemeFromTokens(null)).toEqual(counseliqTheme);
    expect(brandThemeFromTokens("red")).toEqual(counseliqTheme);
    expect(brandThemeFromTokens([1, 2])).toEqual(counseliqTheme);
  });

  test("candidate-theme colors[0] becomes the accent", () => {
    const theme = brandThemeFromTokens({ colors: ["#123456", "#abcdef"], fonts: [] });
    expect(theme.accent).toBe("#123456");
    expect(theme.bg).toBe(counseliqTheme.bg);
  });

  test("seeded brandTokens primaryColor wins over colors[]", () => {
    const theme = brandThemeFromTokens({ primaryColor: "#1a365d", colors: ["#999999"] });
    expect(theme.accent).toBe("#1a365d");
  });

  test("secondaryColor feeds chip and rule tokens", () => {
    const theme = brandThemeFromTokens({ secondaryColor: "#E2231A" });
    expect(theme.chip).toBe("rgba(226,35,26,0.2)");
    expect(theme.rule).toBe("rgba(226,35,26,0.38)");
  });

  test("accentInk is normalized for contrast against accent", () => {
    const darkAccent = brandThemeFromTokens({ primaryColor: "#001122" });
    const lightAccent = brandThemeFromTokens({ primaryColor: "#F7E9A0" });
    expect(darkAccent.accentInk).toBe("#FFFFFF");
    expect(lightAccent.accentInk).toBe("#111827");
  });

  test("rgb colors are accepted from extracted candidate themes", () => {
    const theme = brandThemeFromTokens({ colors: ["rgb(226, 35, 26)"] });
    expect(theme.accent).toBe("rgb(226, 35, 26)");
  });

  test("title and body font tokens head their respective stacks", () => {
    const theme = brandThemeFromTokens({
      titleFontFamily: "Roboto Slab",
      bodyFontFamily: "Open Sans",
    });
    expect(theme.fontDisplay.startsWith("'Roboto Slab'")).toBe(true);
    expect(theme.fontText.startsWith("'Open Sans'")).toBe(true);
  });

  test("legacy fontFamily maps to the title stack only", () => {
    const theme = brandThemeFromTokens({ fontFamily: "Roboto Slab" });
    expect(theme.fontDisplay.startsWith("'Roboto Slab'")).toBe(true);
    expect(theme.fontText).toBe(counseliqTheme.fontText);
  });

  test("candidate-theme fonts map title first and body second", () => {
    const theme = brandThemeFromTokens({ fonts: ["Roboto Slab", "Open Sans"] });
    expect(theme.fontDisplay.startsWith("'Roboto Slab'")).toBe(true);
    expect(theme.fontText.startsWith("'Open Sans'")).toBe(true);
  });

  test("brandRef chooses the matching built-in base theme", () => {
    const theme = brandThemeFromTokens({ brandRef: "la-trobe-university" });
    expect(theme.bg).toBe(latrobeTheme.bg);
    expect(theme.accent).toBe(latrobeTheme.accent);
  });

  test("titleCase can be overridden from brand tokens", () => {
    expect(brandThemeFromTokens({ titleCase: "uppercase" }).titleCase).toBe(
      "uppercase"
    );
    expect(brandThemeFromTokens({ titleCase: "none" }).titleCase).toBe(
      "none"
    );
  });

  test("unreadable background/text pairs fall back to safe ink", () => {
    const theme = brandThemeFromTokens({
      backgroundColor: "#FFFFFF",
      textColor: "#FFFFFF",
    });
    expect(theme.bg).toBe("#FFFFFF");
    expect(theme.ink).toBe("#111827");
  });

  test("non-hex colors are ignored", () => {
    const theme = brandThemeFromTokens({ colors: ["blue"] });
    expect(theme.accent).toBe(counseliqTheme.accent);
  });
});
