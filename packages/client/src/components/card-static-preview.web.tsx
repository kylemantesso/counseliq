"use client";

import { useMemo, useState } from "react";
import { Box, Pressable, Text } from "@counseliq/ui";
import {
  AssetResolverContext,
  BrandThemeProvider,
  CardRenderer,
  CardStage,
  SETTLED_TIMING,
  brandThemeFromTokens,
  counseliqTheme,
} from "@counseliq/cards";
import { validateCardProps } from "@counseliq/course-schema";
import { GoogleBrandFontLoader } from "./theme/google-brand-font-loader.web";
import {
  logoUrlFromBrandTokens,
  withInstitutionLogoOnTitleCard,
} from "../theme/brand-tokens";

/**
 * Settled card render for review surfaces (steps 2/3): the real
 * @counseliq/cards renderer at SETTLED_TIMING inside a scaled 9:16 stage,
 * with prop-validation issue chips and a raw-props toggle underneath.
 */

export interface CardStaticPreviewProps {
  template: string;
  props: Record<string, unknown>;
  /** institutions.brandTokens; absent → counseliq default theme. */
  brandTokens?: unknown;
  /** Optional media resolver (asset id -> presigned URL). */
  resolveAssetRef?: (ref: string) => string | null;
  /** Hide prop-toggle and validation chips when embedded as a thumbnail. */
  showControls?: boolean;
}

export function CardStaticPreview({
  template,
  props,
  brandTokens,
  resolveAssetRef,
  showControls = true,
}: CardStaticPreviewProps) {
  const [showProps, setShowProps] = useState(false);
  const theme = useMemo(
    () =>
      brandTokens === undefined || brandTokens === null
        ? counseliqTheme
        : brandThemeFromTokens(brandTokens),
    [brandTokens]
  );
  const issues = useMemo(
    () => validateCardProps(template, props),
    [template, props]
  );
  const resolver = useMemo(
    () => ({ resolve: (ref: string) => resolveAssetRef?.(ref) ?? null }),
    [resolveAssetRef]
  );
  const institutionLogoUrl = useMemo(
    () => logoUrlFromBrandTokens(brandTokens),
    [brandTokens]
  );
  const renderProps = useMemo(
    () => withInstitutionLogoOnTitleCard(template, props, institutionLogoUrl),
    [template, props, institutionLogoUrl]
  );

  if (!showControls) {
    return (
      <div style={{ width: "100%", height: "100%" }}>
        <GoogleBrandFontLoader fontFamilies={[theme.fontDisplay, theme.fontText, theme.fontMono]} />
        <AssetResolverContext.Provider value={resolver}>
          <BrandThemeProvider theme={theme}>
            <CardStage style={{ borderRadius: 10, boxShadow: "none" }}>
              <CardRenderer
                template={template}
                props={renderProps}
                timing={SETTLED_TIMING}
              />
            </CardStage>
          </BrandThemeProvider>
        </AssetResolverContext.Provider>
      </div>
    );
  }

  return (
    <Box className="gap-1 w-full">
      <GoogleBrandFontLoader fontFamilies={[theme.fontDisplay, theme.fontText, theme.fontMono]} />
      {showProps ? (
        <Box
          className="bg-card border border-border rounded-xl p-3 gap-1"
          style={{ aspectRatio: 9 / 16 }}
        >
          <Box className="flex-1 gap-1">
            {Object.entries(props).map(([key, value]) => (
              <Box key={key} className="flex-row gap-2">
                <Text
                  className="text-xs text-muted-foreground w-24"
                  numberOfLines={1}
                >
                  {key}
                </Text>
                <Text className="text-xs flex-1">
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      ) : (
        <div style={{ width: "100%", aspectRatio: "9 / 16" }}>
          <AssetResolverContext.Provider value={resolver}>
            <BrandThemeProvider theme={theme}>
              <CardStage>
                <CardRenderer
                  template={template}
                  props={renderProps}
                  timing={SETTLED_TIMING}
                />
              </CardStage>
            </BrandThemeProvider>
          </AssetResolverContext.Provider>
        </div>
      )}
      {showControls ? (
        <Box className="flex-row flex-wrap items-center gap-1">
          <Pressable
            onPress={() => setShowProps((current) => !current)}
            className="border border-border rounded-full px-2 py-0.5"
          >
            <Text className="text-xs text-muted-foreground">
              {showProps ? "card" : "props"}
            </Text>
          </Pressable>
          {issues.map((issue, index) => (
            <Box
              key={`issue-${index}`}
              className="bg-destructive/10 border border-destructive rounded-full px-2 py-0.5"
            >
              <Text className="text-xs text-destructive" numberOfLines={1}>
                {issue.path.join(".") || "props"}: {truncate(issue.message, 60)}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
