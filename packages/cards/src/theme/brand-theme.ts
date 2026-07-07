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
  /** Display (heading) font stack. */
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

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value.trim());
}

/**
 * Map loose institution brand data — `institutions.brandTokens` or an
 * extracted candidate theme ({ colors[], fonts[] }) — onto a full
 * BrandTheme, falling back to counseliq defaults for anything missing or
 * malformed. Colors: [0] → accent. Fonts: [0] → display stack head.
 */
export function brandThemeFromTokens(tokens: unknown): BrandTheme {
  const base = counseliqTheme;
  if (!isRecord(tokens)) return base;

  const out: BrandTheme = { ...base };

  const colors = Array.isArray(tokens.colors) ? tokens.colors : [];
  if (isHexColor(colors[0])) out.accent = colors[0].trim();
  // Explicit named tokens win over positional candidate colors.
  if (isHexColor(tokens.primaryColor)) out.accent = (tokens.primaryColor as string).trim();

  const fonts = Array.isArray(tokens.fonts) ? tokens.fonts : [];
  const font = typeof tokens.fontFamily === "string" ? tokens.fontFamily : fonts[0];
  if (typeof font === "string" && font.trim().length > 0) {
    const head = font.includes(",") ? font : `'${font.trim()}'`;
    out.fontDisplay = `${head}, ${base.fontDisplay}`;
    out.fontText = `${head}, ${base.fontText}`;
  }
  return out;
}
