import { Box, Text } from "@counseliq/ui";

/**
 * Native fallback: the structured prop dump the gate-2 screen shipped with.
 * The real settled card render is web-only (`card-static-preview.web.tsx`)
 * because @counseliq/cards is a React DOM package.
 */

export interface CardStaticPreviewProps {
  template: string;
  props: Record<string, unknown>;
  /** institutions.brandTokens (web render themes with it; unused here). */
  brandTokens?: unknown;
  /** Optional web resolver for media refs (asset id -> presigned URL). */
  resolveAssetRef?: (ref: string) => string | null;
  /** Web-only: hide preview controls/chips when embedded as a thumbnail. */
  showControls?: boolean;
}

export function CardStaticPreview({ template, props }: CardStaticPreviewProps) {
  return (
    <Box
      className="bg-card border border-border rounded-xl p-3 gap-1 w-full"
      style={{ aspectRatio: 9 / 16 }}
    >
      <Text className="text-xs font-semibold">{template}</Text>
      <Box className="flex-1 gap-1">
        {Object.entries(props).map(([key, value]) => (
          <Box key={key} className="flex-row gap-2">
            <Text className="text-xs text-muted-foreground w-24" numberOfLines={1}>
              {key}
            </Text>
            <Text className="text-xs flex-1">
              {typeof value === "string" ? value : JSON.stringify(value)}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
