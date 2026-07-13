/**
 * Brand theme tokens — the CSS-custom-property contract every template
 * renders against. Token names and both built-in themes are lifted from the
 * design mockups (design/CounselIQ Card Templates.dc.html themes A/B).
 */

export interface BrandTheme {
  /** Card background. */
  bg: string;
  /** Primary text on bg. */
  ink: string;
  /** Secondary text on bg. */
  dim: string;
  /** Brand accent. */
  accent: string;
  /** Text placed ON the accent. */
  accentInk: string;
  /** Hairline rules on bg. */
  rule: string;
  /** Subtle chip/pill fill on bg. */
  chip: string;
  /** Light "paper" panel fill (document-callout, comparison panels). */
  paper: string;
  /** Primary text on paper. */
  paperInk: string;
  /** Secondary text on paper. */
  paperDim: string;
  /** Hairline rules on paper. */
  paperRule: string;
  /** Title/display (heading) font stack. */
  fontDisplay: string;
  /** Body font stack. */
  fontText: string;
  /** Mono font stack (source labels, data). */
  fontMono: string;
  /** text-transform for display type ("none" | "uppercase"). */
  titleCase: string;
  /** letter-spacing for display type. */
  tracking: string;
  /** font-weight for display type. */
  displayWeight: string;
  /** Card corner radius. */
  radius: string;
  /** Small radius (chips, inner panels). */
  radiusSm: string;
  /** Stage frame color behind the card. */
  frame: string;
  /** CSS filter applied to photography ("none" | e.g. grayscale). */
  imageFilter: string;
  /** Placeholder gradient endpoints for unresolved imagery. */
  placeholderA: string;
  placeholderB: string;
  /** Text over photography. */
  photoInk: string;
  /** Scrim gradient color over photography. */
  scrim: string;
  /** Card shadow. */
  shadow: string;
}

/** Theme A — CounselIQ house style: dark navy, cream ink, gold accent, serif display. */
export const counseliqTheme: BrandTheme = {
  bg: "#0E1B2C",
  ink: "#F6F1E7",
  dim: "rgba(246,241,231,.64)",
  accent: "#C9A227",
  accentInk: "#0E1B2C",
  rule: "rgba(246,241,231,.16)",
  chip: "rgba(246,241,231,.07)",
  paper: "#F6F1E7",
  paperInk: "#1C2536",
  paperDim: "rgba(28,37,54,.6)",
  paperRule: "rgba(28,37,54,.15)",
  fontDisplay: "'Source Serif 4', Georgia, serif",
  fontText: "'Source Sans 3', 'Segoe UI', sans-serif",
  fontMono: "'IBM Plex Mono', monospace",
  titleCase: "none",
  tracking: "-0.012em",
  displayWeight: "600",
  radius: "14px",
  radiusSm: "8px",
  frame: "#04090F",
  imageFilter: "none",
  placeholderA: "#16273E",
  placeholderB: "#0F1D30",
  photoInk: "#F6F1E7",
  scrim: "rgba(4,9,15,.86)",
  shadow: "0 14px 34px rgba(0,0,0,.32)",
};

/** Theme B — La Trobe institution style: light, red accent, condensed uppercase display. */
export const latrobeTheme: BrandTheme = {
  bg: "#FCFBF9",
  ink: "#141414",
  dim: "rgba(20,20,20,.62)",
  accent: "#E2231A",
  accentInk: "#FFFFFF",
  rule: "rgba(20,20,20,.16)",
  chip: "rgba(20,20,20,.05)",
  paper: "#FFFFFF",
  paperInk: "#141414",
  paperDim: "rgba(20,20,20,.6)",
  paperRule: "rgba(20,20,20,.14)",
  fontDisplay: "'Barlow Condensed', 'Arial Narrow', sans-serif",
  fontText: "'Barlow', 'Segoe UI', sans-serif",
  fontMono: "'IBM Plex Mono', monospace",
  titleCase: "uppercase",
  tracking: ".015em",
  displayWeight: "700",
  radius: "4px",
  radiusSm: "2px",
  frame: "#1A1A1A",
  imageFilter: "grayscale(1) contrast(1.1)",
  placeholderA: "#E5E2DC",
  placeholderB: "#F1EFEB",
  photoInk: "#FFFFFF",
  scrim: "rgba(10,10,10,.82)",
  shadow: "0 14px 34px rgba(0,0,0,.14)",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asTitleCase(value: unknown): "none" | "uppercase" | null {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (normalized === "none" || normalized === "uppercase") {
    return normalized;
  }
  return null;
}

function isCssColor(value: unknown): value is string {
  const color = asNonEmptyString(value);
  if (color === null) return false;
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(color) ||
    /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)$/i.test(
      color
    ) ||
    /^hsla?\(\s*[\d.]+(?:deg|rad|turn)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+)?\s*\)$/i.test(
      color
    )
  );
}

type Rgba = { r: number; g: number; b: number; a: number };

function parseCssColor(value: string): Rgba | null {
  const color = value.trim();
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-fA-F]+$/.test(hex)) {
      return null;
    }
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt(hex[0] + hex[0], 16);
      const g = Number.parseInt(hex[1] + hex[1], 16);
      const b = Number.parseInt(hex[2] + hex[2], 16);
      const a =
        hex.length === 4 ? Number.parseInt(hex[3] + hex[3], 16) / 255 : 1;
      return { r, g, b, a };
    }
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const channels = parts.slice(0, 3).map((part) => {
      if (part.endsWith("%")) {
        const pct = Number.parseFloat(part.slice(0, -1));
        return Number.isFinite(pct) ? Math.round((pct / 100) * 255) : null;
      }
      const n = Number.parseFloat(part);
      return Number.isFinite(n) ? Math.round(n) : null;
    });
    if (channels.some((entry) => entry === null)) return null;
    const alpha = parts[3] ? Number.parseFloat(parts[3]) : 1;
    if (!Number.isFinite(alpha)) return null;
    return {
      r: clamp(channels[0] as number, 0, 255),
      g: clamp(channels[1] as number, 0, 255),
      b: clamp(channels[2] as number, 0, 255),
      a: clamp(alpha, 0, 1),
    };
  }

  const hsl = color.match(/^hsla?\(([^)]+)\)$/i);
  if (hsl) {
    const parts = hsl[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const h = Number.parseFloat(parts[0].replace(/deg|rad|turn/gi, ""));
    const s = Number.parseFloat(parts[1].replace("%", "")) / 100;
    const l = Number.parseFloat(parts[2].replace("%", "")) / 100;
    const alpha = parts[3] ? Number.parseFloat(parts[3]) : 1;
    if (![h, s, l, alpha].every(Number.isFinite)) return null;
    const rgbFromHsl = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
    return { ...rgbFromHsl, a: clamp(alpha, 0, 1) };
  }

  return null;
}

function hslToRgb(
  h: number,
  s: number,
  l: number
): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  if (s === 0) {
    const grey = Math.round(l * 255);
    return { r: grey, g: grey, b: grey };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = hue / 360;
  const toChannel = (t: number) => {
    let tc = t;
    if (tc < 0) tc += 1;
    if (tc > 1) tc -= 1;
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  };
  return {
    r: Math.round(toChannel(hk + 1 / 3) * 255),
    g: Math.round(toChannel(hk) * 255),
    b: Math.round(toChannel(hk - 1 / 3) * 255),
  };
}

function relativeLuminance({ r, g, b }: Pick<Rgba, "r" | "g" | "b">): number {
  const toLinear = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.03928
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(a: Pick<Rgba, "r" | "g" | "b">, b: Pick<Rgba, "r" | "g" | "b">): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function textColorForBackground(color: string): string {
  const bg = parseCssColor(color);
  if (!bg) return "#111827";
  const light = parseCssColor("#FFFFFF") as Rgba;
  const dark = parseCssColor("#111827") as Rgba;
  return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? "#FFFFFF" : "#111827";
}

function toRgbaString(color: string, alpha: number): string | null {
  const parsed = parseCssColor(color);
  if (!parsed) return null;
  return `rgba(${parsed.r},${parsed.g},${parsed.b},${clamp(alpha, 0, 1)})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizedBrandRef(value: unknown): string | null {
  const raw = asNonEmptyString(value);
  if (raw === null) return null;
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function baseThemeFromTokens(tokens: unknown): BrandTheme {
  const pick = (value: unknown) => {
    const normalized = normalizedBrandRef(value);
    if (normalized !== null && normalized.includes("latrobe")) return latrobeTheme;
    return null;
  };

  if (typeof tokens === "string") {
    return pick(tokens) ?? counseliqTheme;
  }
  if (!isRecord(tokens)) return counseliqTheme;

  return (
    pick(tokens.brandRef) ??
    pick(tokens.theme) ??
    pick(tokens.themeName) ??
    pick(tokens.preset) ??
    counseliqTheme
  );
}

/**
 * Map loose institution brand data — `institutions.brandTokens` or an
 * extracted candidate theme ({ colors[], fonts[] }) — onto a full
 * BrandTheme, falling back to counseliq defaults for anything missing or
 * malformed. Colors: [0] → accent. Fonts: [0] → title stack head,
 * Fonts: [1] → body stack head.
 */
export function brandThemeFromTokens(tokens: unknown): BrandTheme {
  const base = baseThemeFromTokens(tokens);
  if (!isRecord(tokens)) return base;

  const out: BrandTheme = { ...base };

  const titleCase = asTitleCase(tokens.titleCase);
  if (titleCase !== null) {
    out.titleCase = titleCase;
  }

  const colors = Array.isArray(tokens.colors) ? tokens.colors : [];
  if (isCssColor(colors[0])) out.accent = colors[0].trim();
  // Explicit named tokens win over positional candidate colors.
  if (isCssColor(tokens.primaryColor)) {
    out.accent = (tokens.primaryColor as string).trim();
  }
  const secondary = isCssColor(tokens.secondaryColor)
    ? (tokens.secondaryColor as string).trim()
    : isCssColor(colors[1])
      ? colors[1].trim()
      : null;
  if (secondary !== null) {
    out.chip = toRgbaString(secondary, 0.2) ?? out.chip;
    out.rule = toRgbaString(secondary, 0.38) ?? out.rule;
    out.paperRule = toRgbaString(secondary, 0.28) ?? out.paperRule;
  }
  out.accentInk = textColorForBackground(out.accent);

  if (isCssColor(tokens.backgroundColor)) {
    out.bg = (tokens.backgroundColor as string).trim();
    const requestedInk = isCssColor(tokens.textColor)
      ? (tokens.textColor as string).trim()
      : null;
    const safeInk = textColorForBackground(out.bg);
    if (requestedInk) {
      const bg = parseCssColor(out.bg);
      const ink = parseCssColor(requestedInk);
      if (bg && ink && contrastRatio(bg, ink) >= 4.5) {
        out.ink = requestedInk;
      } else {
        out.ink = safeInk;
      }
    } else {
      out.ink = safeInk;
    }
    out.dim = toRgbaString(out.ink, 0.64) ?? out.dim;
    out.rule = toRgbaString(out.ink, 0.16) ?? out.rule;
    out.chip = toRgbaString(out.ink, 0.07) ?? out.chip;
  }

  const fonts = Array.isArray(tokens.fonts) ? tokens.fonts : [];
  const titleFont =
    asNonEmptyString(tokens.titleFontFamily) ??
    asNonEmptyString(tokens.fontFamily) ??
    asNonEmptyString(fonts[0]);
  const bodyFont = asNonEmptyString(tokens.bodyFontFamily) ?? asNonEmptyString(fonts[1]);
  if (titleFont !== null) {
    const head = titleFont.includes(",") ? titleFont : `'${titleFont.trim()}'`;
    out.fontDisplay = `${head}, ${base.fontDisplay}`;
  }
  if (bodyFont !== null) {
    const head = bodyFont.includes(",") ? bodyFont : `'${bodyFont.trim()}'`;
    out.fontText = `${head}, ${base.fontText}`;
  }
  return out;
}
