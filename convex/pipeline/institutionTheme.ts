"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { AppErrorCode, appError } from "../errors";

type Rgba = { r: number; g: number; b: number; a: number };

const MAX_CSS_FILES = 8;
const FETCH_TIMEOUT_MS = 12_000;

function normalizeWebsiteUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export const adminExtractInstitutionThemeFromWebsite = action({
  args: {
    institutionId: v.id("institutions"),
    websiteUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(
      internal.pipeline.assetsCatalogue.getInstitutionThemeExtractionContext,
      {
        institutionId: args.institutionId,
      }
    );

    const targetWebsiteUrl = args.websiteUrl ?? context.websiteUrl;
    if (!targetWebsiteUrl) {
      appError(AppErrorCode.INSTITUTION_WEBSITE_URL_REQUIRED);
    }
    const normalizedWebsiteUrl = normalizeWebsiteUrl(targetWebsiteUrl);
    if (!normalizedWebsiteUrl) {
      appError(AppErrorCode.INSTITUTION_WEBSITE_URL_INVALID);
    }

    try {
      const extracted = await extractThemeFromWebsite(normalizedWebsiteUrl);
      return {
        websiteUrl: normalizedWebsiteUrl,
        ...extracted,
      };
    } catch (error) {
      console.error(
        `[pipeline] institution ${args.institutionId}: website theme extraction failed`,
        error instanceof Error ? error.message : String(error)
      );
      return {
        websiteUrl: normalizedWebsiteUrl,
        primaryColor: null,
        secondaryColor: null,
        backgroundColor: null,
        logoUrl: null,
        fontFamily: null,
        palette: [],
        cssSourceCount: 0,
        warning:
          "Could not access this site from the extractor runtime. It may be protected by bot filtering.",
      };
    }
  },
});

async function extractThemeFromWebsite(websiteUrl: string): Promise<{
  primaryColor: string | null;
  secondaryColor: string | null;
  backgroundColor: string | null;
  logoUrl: string | null;
  fontFamily: string | null;
  palette: string[];
  cssSourceCount: number;
  warning?: string;
}> {
  const homepage = await fetchText(websiteUrl, { allowNonOk: true });
  const homepageHtml = homepage.text;
  const baseUrl = new URL(websiteUrl);

  if (isBotProtectionPage(homepage.status, homepageHtml)) {
    return {
      primaryColor: null,
      secondaryColor: null,
      backgroundColor: null,
      logoUrl: null,
      fontFamily: null,
      palette: [],
      cssSourceCount: 0,
      warning:
        "This website blocked automated extraction (bot protection). Enter colors/logo manually.",
    };
  }
  const styleBlocks = extractStyleBlocks(homepageHtml);
  const inlineStyleDeclarations = extractInlineStyleDeclarations(homepageHtml);
  const stylesheetUrls = extractSameOriginStylesheetUrls(homepageHtml, baseUrl).slice(
    0,
    MAX_CSS_FILES
  );

  const cssTexts: string[] = [];
  for (const cssUrl of stylesheetUrls) {
    try {
      cssTexts.push((await fetchText(cssUrl)).text);
    } catch {
      // Non-fatal: a blocked stylesheet should not fail extraction entirely.
    }
  }

  const cssBlob = [
    ...styleBlocks,
    inlineStyleDeclarations,
    ...cssTexts,
  ]
    .filter((value) => value.trim().length > 0)
    .join("\n");

  const scoredColors = scoreColors(cssBlob);
  const palette = rankedPalette(scoredColors).slice(0, 6);
  const [primaryColor, secondaryColor] = pickPrimaryAndSecondary(palette);
  const backgroundColor = pickBackgroundColor(cssBlob, palette, primaryColor);
  const logoUrl = extractLogoUrl(homepageHtml, baseUrl);
  const fontFamily = pickPrimaryFontFamily(cssBlob);

  return {
    primaryColor,
    secondaryColor,
    backgroundColor,
    logoUrl,
    fontFamily,
    palette,
    cssSourceCount: cssTexts.length + styleBlocks.length,
  };
}

function pickBackgroundColor(
  cssText: string,
  palette: string[],
  primaryColor: string | null
): string | null {
  const scores = new Map<string, number>();
  const declarationRegex = /([\w-]+)\s*:\s*([^;{}]+);/g;
  for (const match of cssText.matchAll(declarationRegex)) {
    const property = (match[1] ?? "").toLowerCase();
    if (!property.includes("background")) continue;

    const colors = parseColors(match[2] ?? "").filter((color) => color.a >= 0.85);
    if (colors.length === 0) continue;

    let weight = 3;
    if (property.startsWith("--")) weight += 2;
    if (property.includes("body") || property.includes("page") || property.includes("surface")) {
      weight += 4;
    }
    if (property.includes("overlay") || property.includes("hero")) {
      weight -= 2;
    }

    for (const color of colors) {
      const hex = toHex(color);
      const sat = colorSaturation(color);
      const neutralBoost = sat < 0.14 ? 2 : 0;
      scores.set(hex, (scores.get(hex) ?? 0) + weight + neutralBoost);
    }
  }

  const rankedBackgrounds = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const nonExtremeBackground = rankedBackgrounds.find(([hex]) => {
    const parsed = parseHex(hex);
    return parsed !== null && !isNearWhiteOrBlack(parsed);
  });
  if (nonExtremeBackground) {
    return nonExtremeBackground[0];
  }

  if (rankedBackgrounds.length > 0) {
    const chosen = rankedBackgrounds[0]![0];
    const parsed = parseHex(chosen);
    if (parsed && isNearWhiteOrBlack(parsed) && primaryColor) {
      const primary = parseHex(primaryColor);
      if (primary) return deriveBackgroundFromPrimary(primary);
    }
    return chosen;
  }

  const neutralFromPalette = palette.find((hex) => {
    const parsed = parseHex(hex);
    return parsed !== null && colorSaturation(parsed) < 0.14;
  });
  if (neutralFromPalette) {
    const parsed = parseHex(neutralFromPalette);
    if (parsed && isNearWhiteOrBlack(parsed) && primaryColor) {
      const primary = parseHex(primaryColor);
      if (primary) return deriveBackgroundFromPrimary(primary);
    }
    return neutralFromPalette;
  }

  if (primaryColor) {
    const primary = parseHex(primaryColor);
    if (primary) return deriveBackgroundFromPrimary(primary);
  }
  return null;
}

function extractLogoUrl(html: string, baseUrl: URL): string | null {
  type Candidate = { url: string; score: number };
  const candidates: Candidate[] = [];

  const metaRegex = /<meta\b[^>]*>/gi;
  for (const match of html.matchAll(metaRegex)) {
    const tag = match[0];
    const property = (readAttribute(tag, "property") ?? "").toLowerCase();
    const name = (readAttribute(tag, "name") ?? "").toLowerCase();
    const key = property || name;
    const content = readAttribute(tag, "content");
    if (!content) continue;

    let score = 0;
    if (key === "og:logo") score = 90;
    else if (key === "og:image") score = 48;
    else if (key === "twitter:image") score = 38;
    else if (key.includes("logo")) score = 70;
    if (score <= 0) continue;

    const resolved = resolveUrl(content, baseUrl);
    if (!resolved) continue;
    candidates.push({ url: resolved, score: score + originAffinity(resolved, baseUrl) });
  }

  const linkRegex = /<link\b[^>]*>/gi;
  for (const match of html.matchAll(linkRegex)) {
    const tag = match[0];
    const rel = (readAttribute(tag, "rel") ?? "").toLowerCase();
    const href = readAttribute(tag, "href");
    if (!href) continue;

    let score = 0;
    if (rel.includes("apple-touch-icon")) score = 30;
    else if (rel.includes("mask-icon")) score = 28;
    else if (rel.includes("icon")) score = 18;
    if (rel.includes("logo")) score += 40;
    if (score <= 0) continue;

    const resolved = resolveUrl(href, baseUrl);
    if (!resolved) continue;
    candidates.push({ url: resolved, score: score + originAffinity(resolved, baseUrl) });
  }

  const imgRegex = /<img\b[^>]*>/gi;
  for (const match of html.matchAll(imgRegex)) {
    const tag = match[0];
    const src = readAttribute(tag, "src");
    if (!src || src.startsWith("data:")) continue;
    const resolved = resolveUrl(src, baseUrl);
    if (!resolved) continue;

    const alt = (readAttribute(tag, "alt") ?? "").toLowerCase();
    const cls = (readAttribute(tag, "class") ?? "").toLowerCase();
    const id = (readAttribute(tag, "id") ?? "").toLowerCase();
    const srcLower = resolved.toLowerCase();
    const hintText = `${alt} ${cls} ${id} ${srcLower}`;

    let score = 0;
    if (/(^|\W)(logo|wordmark|brand|crest|emblem)(\W|$)/.test(hintText)) {
      score += 70;
    }
    if (/(^|\W)(header|nav|navbar|masthead)(\W|$)/.test(hintText)) {
      score += 14;
    }
    if (/(^|\W)(icon|sprite|avatar|favicon)(\W|$)/.test(hintText)) {
      score -= 18;
    }

    const width = Number.parseInt(readAttribute(tag, "width") ?? "", 10);
    const height = Number.parseInt(readAttribute(tag, "height") ?? "", 10);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      const ratio = Math.max(width, height) / Math.min(width, height);
      if (ratio <= 3.6) score += 8;
      if (ratio > 8) score -= 8;
      if (Math.max(width, height) <= 480) score += 8;
    }

    if (score <= 0) continue;
    candidates.push({ url: resolved, score: score + originAffinity(resolved, baseUrl) });
  }

  const bestByUrl = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const existing = bestByUrl.get(candidate.url);
    if (!existing || candidate.score > existing.score) {
      bestByUrl.set(candidate.url, candidate);
    }
  }
  const ranked = [...bestByUrl.values()].sort((a, b) => b.score - a.score);
  return ranked[0]?.url ?? null;
}

function resolveUrl(input: string, baseUrl: URL): string | null {
  try {
    const resolved = new URL(input, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function originAffinity(url: string, baseUrl: URL): number {
  try {
    const target = new URL(url);
    if (target.origin === baseUrl.origin) return 12;
    if (target.hostname === baseUrl.hostname) return 8;
    return 0;
  } catch {
    return 0;
  }
}

async function fetchText(
  url: string,
  options?: { allowNonOk?: boolean }
): Promise<{ text: string; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,text/css,*/*;q=0.8",
        "accept-language": "en-AU,en;q=0.9",
      },
      signal: controller.signal,
    });
    if (!response.ok && !options?.allowNonOk) {
      throw new Error(`request failed: ${response.status} ${response.statusText}`);
    }
    return { text: await response.text(), status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function isBotProtectionPage(status: number, html: string): boolean {
  if (status !== 403 && status !== 429) return false;
  const lower = html.toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("cf-challenge") ||
    lower.includes("cf-browser-verification") ||
    lower.includes("cloudflare")
  );
}

function extractStyleBlocks(html: string): string[] {
  const blocks: string[] = [];
  const regex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const match of html.matchAll(regex)) {
    const css = (match[1] ?? "").trim();
    if (css) blocks.push(css);
  }
  return blocks;
}

function extractInlineStyleDeclarations(html: string): string {
  const declarations: string[] = [];
  const regex = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi;
  for (const match of html.matchAll(regex)) {
    const declaration = (match[2] ?? "").trim();
    if (declaration) declarations.push(declaration.endsWith(";") ? declaration : `${declaration};`);
  }
  return declarations.join("\n");
}

function extractSameOriginStylesheetUrls(html: string, baseUrl: URL): string[] {
  const urls: string[] = [];
  const linkRegex = /<link\b[^>]*>/gi;
  for (const match of html.matchAll(linkRegex)) {
    const tag = match[0];
    const rel = readAttribute(tag, "rel")?.toLowerCase() ?? "";
    if (!rel.split(/\s+/).includes("stylesheet")) continue;
    const href = readAttribute(tag, "href");
    if (!href) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.origin !== baseUrl.origin) continue;
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      urls.push(resolved.toString());
    } catch {
      // ignore malformed href
    }
  }
  return [...new Set(urls)];
}

function readAttribute(tag: string, attributeName: string): string | null {
  const quoted = new RegExp(
    `\\b${attributeName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,
    "i"
  );
  const quotedMatch = tag.match(quoted);
  if (quotedMatch) {
    return quotedMatch[2]?.trim() ?? null;
  }
  const unquoted = new RegExp(`\\b${attributeName}\\s*=\\s*([^\\s>]+)`, "i");
  const unquotedMatch = tag.match(unquoted);
  return unquotedMatch?.[1]?.trim() ?? null;
}

function scoreColors(cssText: string): Map<string, { score: number; hits: number }> {
  const map = new Map<string, { score: number; hits: number }>();
  const declarationRegex = /([\w-]+)\s*:\s*([^;{}]+);/g;
  for (const match of cssText.matchAll(declarationRegex)) {
    const property = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? "";
    const colors = parseColors(value);
    if (colors.length === 0) continue;
    let baseScore = 1;
    if (property.startsWith("--")) baseScore += 3;
    if (property.includes("primary") || property.includes("accent") || property.includes("brand")) {
      baseScore += 12;
    }
    if (property.includes("secondary")) baseScore += 10;
    if (property.includes("background")) baseScore += 5;
    if (property === "color" || property.endsWith("-color")) baseScore += 4;
    if (property.includes("border") || property === "fill" || property === "stroke") {
      baseScore += 2;
    }

    for (const color of colors) {
      if (color.a < 0.4) continue;
      const hex = toHex(color);
      const saturation = colorSaturation(color);
      const score = baseScore + (saturation >= 0.12 ? 2 : -4);
      const entry = map.get(hex) ?? { score: 0, hits: 0 };
      entry.score += score;
      entry.hits += 1;
      map.set(hex, entry);
    }
  }
  return map;
}

function rankedPalette(scoredColors: Map<string, { score: number; hits: number }>): string[] {
  return [...scoredColors.entries()]
    .sort((a, b) => {
      const left = a[1].score + a[1].hits * 0.75;
      const right = b[1].score + b[1].hits * 0.75;
      return right - left;
    })
    .map(([hex]) => hex);
}

function pickPrimaryAndSecondary(palette: string[]): [string | null, string | null] {
  if (palette.length === 0) return [null, null];
  const primary =
    palette.find((hex) => {
      const color = parseHex(hex);
      return color !== null && !isNeutral(color);
    }) ?? palette[0]!;

  const primaryColor = parseHex(primary);
  if (!primaryColor) return [primary, null];
  const passesDistance = (candidate: Pick<Rgba, "r" | "g" | "b">) =>
    colorDistance(primaryColor, candidate) >= 28;
  const secondaryCandidate =
    palette.find((hex) => {
      if (hex === primary) return false;
      const candidate = parseHex(hex);
      if (!candidate) return false;
      return (
        passesDistance(candidate) &&
        !isNeutral(candidate) &&
        !isNearWhiteOrBlack(candidate)
      );
    }) ??
    palette.find((hex) => {
      if (hex === primary) return false;
      const candidate = parseHex(hex);
      if (!candidate) return false;
      return passesDistance(candidate) && !isNearWhiteOrBlack(candidate);
    }) ??
    palette.find((hex) => {
      if (hex === primary) return false;
      const candidate = parseHex(hex);
      if (!candidate) return false;
      return passesDistance(candidate);
    }) ??
    null;
  if (secondaryCandidate) {
    return [primary, secondaryCandidate];
  }
  return [primary, deriveSecondaryFromPrimary(primaryColor)];
}

function pickPrimaryFontFamily(cssText: string): string | null {
  const genericFamilies = new Set([
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "emoji",
    "math",
    "fangsong",
  ]);
  const scores = new Map<string, number>();
  const declarationRegex = /([\w-]+)\s*:\s*([^;{}]+);/g;
  for (const match of cssText.matchAll(declarationRegex)) {
    const property = (match[1] ?? "").toLowerCase();
    if (!property.includes("font")) continue;
    const value = (match[2] ?? "").replace(/!important/gi, "");
    const families = value
      .split(",")
      .map((segment) => segment.replace(/^['"]|['"]$/g, "").trim())
      .filter((family) => family.length > 0)
      .filter((family) => !family.startsWith("var("));
    let weight = 1;
    if (property.startsWith("--")) weight += 2;
    if (property.includes("heading") || property.includes("display") || property.includes("title")) {
      weight += 3;
    }
    if (property.includes("body") || property.includes("text")) weight += 2;
    for (const family of families) {
      if (genericFamilies.has(family.toLowerCase())) continue;
      scores.set(family, (scores.get(family) ?? 0) + weight);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

function parseColors(value: string): Rgba[] {
  const out: Rgba[] = [];
  const tokenRegex = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
  for (const tokenMatch of value.matchAll(tokenRegex)) {
    const token = tokenMatch[0];
    const parsed = parseColorToken(token);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseColorToken(token: string): Rgba | null {
  if (token.startsWith("#")) {
    return parseHex(token);
  }
  if (/^rgba?\(/i.test(token)) {
    const inner = token.slice(token.indexOf("(") + 1, token.lastIndexOf(")"));
    const parts = inner.split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const rgb = parts.slice(0, 3).map(parseRgbPart);
    if (rgb.some((value) => value === null)) return null;
    const alpha = parts[3] ? parseAlphaPart(parts[3]) : 1;
    if (alpha === null) return null;
    return {
      r: rgb[0] as number,
      g: rgb[1] as number,
      b: rgb[2] as number,
      a: alpha,
    };
  }
  if (/^hsla?\(/i.test(token)) {
    const inner = token.slice(token.indexOf("(") + 1, token.lastIndexOf(")"));
    const parts = inner.split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const hue = parseFloat(parts[0]!.replace(/deg|rad|turn/gi, ""));
    const sat = parsePercentage(parts[1]);
    const light = parsePercentage(parts[2]);
    const alpha = parts[3] ? parseAlphaPart(parts[3]) : 1;
    if (!Number.isFinite(hue) || sat === null || light === null || alpha === null) {
      return null;
    }
    const rgb = hslToRgb(hue, sat, light);
    return { ...rgb, a: alpha };
  }
  return null;
}

function parseHex(hex: string): Rgba | null {
  const value = hex.trim().replace(/^#/, "");
  if (![3, 4, 6, 8].includes(value.length)) return null;
  if (!/^[0-9a-fA-F]+$/.test(value)) return null;
  if (value.length === 3 || value.length === 4) {
    const r = Number.parseInt(value[0] + value[0], 16);
    const g = Number.parseInt(value[1] + value[1], 16);
    const b = Number.parseInt(value[2] + value[2], 16);
    const a =
      value.length === 4
        ? Number.parseInt(value[3] + value[3], 16) / 255
        : 1;
    return { r, g, b, a };
  }
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const a = value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function parseRgbPart(part: string): number | null {
  if (part.endsWith("%")) {
    const percent = Number.parseFloat(part.slice(0, -1));
    if (!Number.isFinite(percent)) return null;
    return clamp(Math.round((percent / 100) * 255), 0, 255);
  }
  const value = Number.parseFloat(part);
  if (!Number.isFinite(value)) return null;
  return clamp(Math.round(value), 0, 255);
}

function parseAlphaPart(part: string): number | null {
  const value = Number.parseFloat(part.replace(/%$/, ""));
  if (!Number.isFinite(value)) return null;
  if (part.endsWith("%")) {
    return clamp(value / 100, 0, 1);
  }
  return clamp(value, 0, 1);
}

function parsePercentage(part: string): number | null {
  const value = Number.parseFloat(part.replace(/%$/, ""));
  if (!Number.isFinite(value)) return null;
  return clamp(value / 100, 0, 1);
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  if (s === 0) {
    const grey = Math.round(l * 255);
    return { r: grey, g: grey, b: grey };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = hue / 360;
  const channels = [hk + 1 / 3, hk, hk - 1 / 3].map((t) => {
    let tc = t;
    if (tc < 0) tc += 1;
    if (tc > 1) tc -= 1;
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  });
  return {
    r: Math.round(channels[0]! * 255),
    g: Math.round(channels[1]! * 255),
    b: Math.round(channels[2]! * 255),
  };
}

function toHex(color: Rgba): string {
  const toChannel = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();
  return `#${toChannel(color.r)}${toChannel(color.g)}${toChannel(color.b)}`;
}

function colorSaturation(color: Pick<Rgba, "r" | "g" | "b">): number {
  const rn = color.r / 255;
  const gn = color.g / 255;
  const bn = color.b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const lightness = (max + min) / 2;
  return lightness > 0.5
    ? (max - min) / (2 - max - min)
    : (max - min) / (max + min);
}

function isNeutral(color: Pick<Rgba, "r" | "g" | "b">): boolean {
  return colorSaturation(color) < 0.12;
}

function colorDistance(
  a: Pick<Rgba, "r" | "g" | "b">,
  b: Pick<Rgba, "r" | "g" | "b">
): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function relativeLuminance(color: Pick<Rgba, "r" | "g" | "b">): number {
  const toLinear = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.03928
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * toLinear(color.r) +
    0.7152 * toLinear(color.g) +
    0.0722 * toLinear(color.b)
  );
}

function isNearWhiteOrBlack(color: Pick<Rgba, "r" | "g" | "b">): boolean {
  const luminance = relativeLuminance(color);
  return luminance <= 0.05 || luminance >= 0.95;
}

function rgbToHsl(color: Pick<Rgba, "r" | "g" | "b">): {
  h: number;
  s: number;
  l: number;
} {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s, l };
}

function deriveSecondaryFromPrimary(primary: Pick<Rgba, "r" | "g" | "b">): string {
  const hsl = rgbToHsl(primary);
  const nextHue = hsl.h + 18;
  const nextSat = clamp(Math.max(0.42, hsl.s * 0.92), 0, 1);
  const nextLight =
    hsl.l > 0.55
      ? 0.34
      : hsl.l < 0.32
        ? 0.56
        : clamp(hsl.l + 0.18, 0, 1);
  const rgb = hslToRgb(nextHue, nextSat, nextLight);
  return toHex({ ...rgb, a: 1 });
}

function deriveBackgroundFromPrimary(primary: Pick<Rgba, "r" | "g" | "b">): string {
  const hsl = rgbToHsl(primary);
  const targetLight = hsl.l < 0.45 ? 0.12 : 0.94;
  const targetSat = hsl.l < 0.45 ? 0.28 : 0.16;
  const rgb = hslToRgb(hsl.h, targetSat, targetLight);
  return toHex({ ...rgb, a: 1 });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
