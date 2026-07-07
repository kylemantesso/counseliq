"use client";

import { useQuery } from "convex/react";
import { useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  ScrollView,
  Text,
} from "@counseliq/ui";
import { Pressable } from "react-native";
import { AdminGuard } from "../components/admin-guard";
import { Screen } from "../components/screen";
import { api } from "../db/api";

export function AdminSourceDocsScreen() {
  return (
    <AdminGuard>
      <AdminSourceDocsContent />
    </AdminGuard>
  );
}

function AdminSourceDocsContent() {
  const router = useRouter();
  const docs = useQuery(api.pipeline.queries.listSourceDocs);

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center">
        <Heading size="md">Source documents</Heading>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <ButtonText>Back</ButtonText>
        </Button>
      </Box>
      <ScrollView className="flex-1 w-full">
        <Box className="flex-col gap-3 p-6">
          {docs === undefined ? (
            <Text>Loading...</Text>
          ) : docs.length === 0 ? (
            <Text className="text-muted-foreground">
              No source documents ingested yet.
            </Text>
          ) : (
            docs.map((doc) => (
              <Pressable
                key={doc._id}
                onPress={() => router.push(`/admin/source-docs/${doc._id}`)}
              >
                <Box className="bg-card border border-border rounded-xl p-4 gap-1">
                  <Text className="font-semibold">
                    {doc.kind.toUpperCase()} · {doc.status}
                    {doc.pageCount !== undefined
                      ? ` · ${doc.pageCount} pages`
                      : ""}
                  </Text>
                  <Text className="text-muted-foreground text-sm" numberOfLines={1}>
                    {doc.objectKey}
                  </Text>
                  <Text className="text-muted-foreground text-xs">
                    {doc._id}
                    {doc.themeExtracted ? " · theme extracted" : ""}
                  </Text>
                  {doc.runId ? (
                    <Pressable
                      onPress={() => router.push(`/admin/runs/${doc.runId}`)}
                    >
                      <Text className="text-primary text-xs">
                        View run {doc.runId} →
                      </Text>
                    </Pressable>
                  ) : null}
                </Box>
              </Pressable>
            ))
          )}
        </Box>
      </ScrollView>
    </Screen>
  );
}
