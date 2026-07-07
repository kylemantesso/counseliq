"use client";

import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { useParams, useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  ScrollView,
  Text,
} from "@counseliq/ui";
import { Image, View } from "react-native";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { Screen } from "../components/screen";
import { api } from "../db/api";

export function AdminSourceDocDetailScreen() {
  return (
    <AdminGuard>
      <AdminSourceDocDetailContent />
    </AdminGuard>
  );
}

function AdminSourceDocDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sourceDocId = params?.id as Id<"sourceDocs"> | undefined;

  const result = useQuery(
    api.pipeline.queries.getSourceDoc,
    sourceDocId ? { sourceDocId } : "skip"
  );
  const presignBatch = useAction(api.pipeline.objectStore.adminPresignGetBatch);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const doc = result?.doc;
  const slides = result?.slides;

  useEffect(() => {
    if (!doc || !slides) return;
    const keys = [
      ...slides.flatMap((s) => [s.pngKey, ...(s.thumbKey ? [s.thumbKey] : [])]),
      ...(doc.theme?.logoCandidates ?? []),
    ];
    if (keys.length === 0) return;
    let cancelled = false;
    presignBatch({ keys })
      .then((entries) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const entry of entries) map[entry.key] = entry.url;
        setUrls(map);
      })
      .catch(() => {
        // Object store may not be configured in this environment; the page
        // still shows text, notes, and provenance.
      });
    return () => {
      cancelled = true;
    };
  }, [doc, slides, presignBatch]);

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center">
        <Heading size="md">Source document</Heading>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <ButtonText>Back</ButtonText>
        </Button>
      </Box>
      <ScrollView className="flex-1 w-full">
        <Box className="flex-col gap-4 p-6">
          {result === undefined ? (
            <Text>Loading...</Text>
          ) : result === null || !doc ? (
            <Text className="text-muted-foreground">Document not found.</Text>
          ) : (
            <>
              <Box className="bg-card border border-border rounded-xl p-4 gap-1">
                <Text className="font-semibold">
                  {doc.kind.toUpperCase()} · {doc.status}
                  {doc.pageCount !== undefined ? ` · ${doc.pageCount} pages` : ""}
                </Text>
                <Text className="text-muted-foreground text-sm">
                  {doc.objectKey}
                </Text>
                {doc.sourceDocHash ? (
                  <Text className="text-muted-foreground text-xs">
                    sha256 {doc.sourceDocHash}
                  </Text>
                ) : null}
              </Box>

              <ThemeCard
                theme={doc.theme ?? null}
                urls={urls}
                converted={doc.status === "converted"}
              />

              {slides && slides.length > 0 ? (
                <Box className="flex-row flex-wrap gap-4">
                  {slides.map((slide) => (
                    <Box
                      key={slide._id}
                      className="bg-card border border-border rounded-xl p-4 gap-2 w-80"
                    >
                      <Text className="font-semibold">Page {slide.n}</Text>
                      {urls[slide.thumbKey ?? slide.pngKey] ? (
                        <Image
                          source={{ uri: urls[slide.thumbKey ?? slide.pngKey] }}
                          resizeMode="contain"
                          style={{
                            width: "100%",
                            aspectRatio: 4 / 3,
                            backgroundColor: "#f4f4f5",
                            borderRadius: 8,
                          }}
                        />
                      ) : (
                        <Box className="w-full aspect-[4/3] bg-background border border-border rounded-lg items-center justify-center">
                          <Text className="text-muted-foreground text-xs">
                            PNG unavailable
                          </Text>
                        </Box>
                      )}
                      <Text className="text-xs text-muted-foreground">
                        {slide.provenanceId ?? `doc:${doc._id}:page:${slide.n}`}
                      </Text>
                      {slide.text ? (
                        <Text className="text-sm" numberOfLines={8}>
                          {slide.text}
                        </Text>
                      ) : (
                        <Text className="text-sm text-muted-foreground">
                          No extracted text.
                        </Text>
                      )}
                      {slide.notes ? (
                        <Text className="text-xs text-muted-foreground" numberOfLines={6}>
                          Notes: {slide.notes}
                        </Text>
                      ) : null}
                      {slide.embeddedImages && slide.embeddedImages.length > 0 ? (
                        <Text className="text-xs text-muted-foreground">
                          {slide.embeddedImages.length} embedded image(s)
                        </Text>
                      ) : null}
                    </Box>
                  ))}
                </Box>
              ) : (
                <Text className="text-muted-foreground">
                  No converted pages yet.
                </Text>
              )}
            </>
          )}
        </Box>
      </ScrollView>
    </Screen>
  );
}

function ThemeCard({
  theme,
  urls,
  converted,
}: {
  theme: {
    colors: string[];
    fonts: string[];
    logoCandidates: string[];
  } | null;
  urls: Record<string, string>;
  converted: boolean;
}) {
  if (!theme) {
    return (
      <Box className="bg-card border border-border rounded-xl p-4">
        <Text className="font-semibold">Theme candidates</Text>
        <Text className="text-muted-foreground text-sm">
          {converted
            ? "No theme extracted (pdf-native document)."
            : "Not converted yet."}
        </Text>
      </Box>
    );
  }
  return (
    <Box className="bg-card border border-border rounded-xl p-4 gap-2">
      <Text className="font-semibold">Theme candidates</Text>
      <Box className="flex-row flex-wrap gap-2 items-center">
        {theme.colors.map((color) => (
          <View
            key={color}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              backgroundColor: color,
              borderWidth: 1,
              borderColor: "#d4d4d8",
            }}
          />
        ))}
        {theme.colors.length === 0 ? (
          <Text className="text-muted-foreground text-sm">No colors.</Text>
        ) : null}
      </Box>
      <Text className="text-sm text-muted-foreground">
        Fonts: {theme.fonts.length > 0 ? theme.fonts.join(", ") : "none"}
      </Text>
      {theme.logoCandidates.length > 0 ? (
        <Box className="flex-row flex-wrap gap-2">
          {theme.logoCandidates.map((key) =>
            urls[key] ? (
              <Image
                key={key}
                source={{ uri: urls[key] }}
                resizeMode="contain"
                style={{
                  width: 96,
                  height: 48,
                  backgroundColor: "#f4f4f5",
                  borderRadius: 6,
                }}
              />
            ) : (
              <Text key={key} className="text-xs text-muted-foreground">
                {key.slice(0, 24)}…
              </Text>
            )
          )}
        </Box>
      ) : (
        <Text className="text-sm text-muted-foreground">
          No logo candidates.
        </Text>
      )}
    </Box>
  );
}
