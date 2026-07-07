import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { counseliqTheme, type BrandTheme } from "./brand-theme";

/**
 * Delivers a BrandTheme to templates two ways at once:
 * - React context (`useBrandTheme`) for JS-side values, and
 * - `--ciq-*` CSS custom properties on a wrapping div, so template inline
 *   styles reference `cssVar("accent")` and re-theme without re-render.
 */

const BrandThemeContext = createContext<BrandTheme>(counseliqTheme);

export function useBrandTheme(): BrandTheme {
  return useContext(BrandThemeContext);
}

/** `cssVar("accentInk")` → `"var(--ciq-accent-ink)"`. */
export function cssVar(token: keyof BrandTheme): string {
  const kebab = token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return `var(--ciq-${kebab})`;
}

export function themeToCssProperties(theme: BrandTheme): CSSProperties {
  const style: Record<string, string> = {};
  for (const [token, value] of Object.entries(theme)) {
    const kebab = token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    style[`--ciq-${kebab}`] = value;
  }
  return style as CSSProperties;
}

export interface BrandThemeProviderProps {
  theme?: BrandTheme;
  children: ReactNode;
  style?: CSSProperties;
}

export function BrandThemeProvider({ theme = counseliqTheme, children, style }: BrandThemeProviderProps) {
  return (
    <BrandThemeContext.Provider value={theme}>
      <div data-ciq-theme="" style={{ display: "contents", ...themeToCssProperties(theme), ...style }}>
        {children}
      </div>
    </BrandThemeContext.Provider>
  );
}
