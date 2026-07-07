"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useParams, useRouter } from "solito/navigation";
import { Link } from "solito/link";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  ScrollView,
  Text,
} from "@counseliq/ui";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { Screen } from "../components/screen";
import { api } from "../db/api";

export function AdminRunDetailScreen() {
  return (
    <AdminGuard>
      <AdminRunDetailContent />
    </AdminGuard>
  );
}

interface ConceptBody {
  type: "concept";
  key: string;
  title: string;
  summary: string;
  pageProvenance: string[];
}

interface FactBody {
  type: "fact";
  conceptKey: string;
  statement: string;
  claimClass: string;
  provenance: string[];
  sourceLabel?: string;
  year?: number;
  flagged: boolean;
  flagReason?: string;
  excluded?: boolean;
}

function AdminRunDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const runId = params?.id as Id<"runs"> | undefined;
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const runResult = useQuery(
    api.pipeline.queries.getRun,
    runId ? { runId } : "skip"
  );
  const inventory = useQuery(
    api.pipeline.inventory.getRunInventory,
    runId ? { runId } : "skip"
  );
  const cost = useQuery(
    api.pipeline.llmCalls.getRunCost,
    runId ? { runId } : "skip"
  );

  const run = runResult?.run;
  const events = runResult?.events ?? [];

  const { concepts, factsByConcept, orphanFacts, entityCount, quoteCount } =
    useMemo(() => {
      const items = inventory?.items ?? [];
      const concepts = items
        .filter((i) => i.kind === "concept")
        .map((i) => i.body as ConceptBody);
      const facts = items
        .filter((i) => i.kind === "fact")
        .map((i) => i.body as FactBody)
        .filter((f) => !flaggedOnly || f.flagged);
      const factsByConcept = new Map<string, FactBody[]>();
      const orphanFacts: FactBody[] = [];
      const conceptKeys = new Set(concepts.map((c) => c.key));
      for (const fact of facts) {
        if (conceptKeys.has(fact.conceptKey)) {
          const list = factsByConcept.get(fact.conceptKey) ?? [];
          list.push(fact);
          factsByConcept.set(fact.conceptKey, list);
        } else {
          orphanFacts.push(fact);
        }
      }
      return {
        concepts,
        factsByConcept,
        orphanFacts,
        entityCount: items.filter((i) => i.kind === "entity").length,
        quoteCount: items.filter((i) => i.kind === "quote").length,
      };
    }, [inventory, flaggedOnly]);

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center">
        <Heading size="md">Run detail</Heading>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <ButtonText>Back</ButtonText>
        </Button>
      </Box>
      <ScrollView className="flex-1 w-full">
        <Box className="flex-col gap-4 p-6">
          {runResult === undefined ? (
            <Text>Loading...</Text>
          ) : !run ? (
            <Text className="text-muted-foreground">Run not found.</Text>
          ) : (
            <>
              <Box className="bg-card border border-border rounded-xl p-4 gap-1">
                <Text className="font-semibold">State: {run.state}</Text>
                <Text className="text-muted-foreground text-xs">{run._id}</Text>
                {run.promptVersions &&
                Object.keys(run.promptVersions).length > 0 ? (
                  <Text className="text-muted-foreground text-xs">
                    Prompts: {JSON.stringify(run.promptVersions)}
                  </Text>
                ) : null}
                {run.state === "GATE_1_KNOWLEDGE_REVIEW" && runId ? (
                  <Link href={`/admin/runs/${runId}/gate-1`}>
                    <Text className="text-primary font-semibold">
                      Open gate-1 review →
                    </Text>
                  </Link>
                ) : null}
                {runId &&
                (run.state === "GATE_2_COURSE_REVIEW" ||
                  (run.courseId &&
                    ["COMPILED", "QA_RUNNING", "QA_PASSED", "QA_FLAGGED"].includes(
                      run.state
                    ))) ? (
                  <Link href={`/admin/runs/${runId}/gate-2`}>
                    <Text className="text-primary font-semibold">
                      {run.state === "GATE_2_COURSE_REVIEW"
                        ? "Open gate-2 course review →"
                        : "View compiled course →"}
                    </Text>
                  </Link>
                ) : null}
              </Box>

              {cost && cost.totalCalls > 0 ? (
                <Box className="bg-card border border-border rounded-xl p-4 gap-1">
                  <Text className="font-semibold">
                    LLM cost: ${cost.totalUsd.toFixed(4)} · {cost.totalCalls}{" "}
                    calls
                  </Text>
                  {cost.byStage.map((row) => (
                    <Text
                      key={`${row.stage}-${row.model}`}
                      className="text-muted-foreground text-xs"
                    >
                      {row.stage} [{row.model}]: ${row.costUsd.toFixed(4)} ·{" "}
                      {row.calls} call(s) · {row.tokensIn}/{row.tokensOut} tokens
                    </Text>
                  ))}
                </Box>
              ) : null}

              <Box className="bg-card border border-border rounded-xl p-4 gap-2">
                <Box className="flex-row justify-between items-center">
                  <Text className="font-semibold">
                    Knowledge inventory
                    {inventory
                      ? ` — ${inventory.counts.concepts} concepts, ${inventory.counts.facts} facts (${inventory.counts.flagged} flagged), ${entityCount} entities, ${quoteCount} quotes`
                      : ""}
                  </Text>
                  <Button
                    variant={flaggedOnly ? "default" : "outline"}
                    size="sm"
                    onPress={() => setFlaggedOnly((v) => !v)}
                  >
                    <ButtonText>
                      {flaggedOnly ? "Flagged only" : "All facts"}
                    </ButtonText>
                  </Button>
                </Box>
                {inventory === undefined ? (
                  <Text>Loading inventory…</Text>
                ) : concepts.length === 0 ? (
                  <Text className="text-muted-foreground">
                    No inventory yet (extraction has not run).
                  </Text>
                ) : (
                  concepts.map((concept) => (
                    <ConceptCard
                      key={concept.key}
                      concept={concept}
                      facts={factsByConcept.get(concept.key) ?? []}
                    />
                  ))
                )}
                {orphanFacts.length > 0 ? (
                  <ConceptCard
                    concept={{
                      type: "concept",
                      key: "(unattached)",
                      title: "Unattached facts",
                      summary: "",
                      pageProvenance: [],
                    }}
                    facts={orphanFacts}
                  />
                ) : null}
              </Box>

              <Box className="bg-card border border-border rounded-xl p-4 gap-1">
                <Text className="font-semibold">Events</Text>
                {events.map((event) => (
                  <Text
                    key={event._id}
                    className="text-muted-foreground text-xs"
                  >
                    {new Date(event._creationTime).toISOString()}{" "}
                    {event.fromState} → {event.toState} ({event.actor})
                    {event.detail ? ` — ${event.detail}` : ""}
                  </Text>
                ))}
              </Box>
            </>
          )}
        </Box>
      </ScrollView>
    </Screen>
  );
}

/** doc:{sourceDocId}:page:{n} → link target + label. */
function provenanceLink(provenanceId: string) {
  const match = provenanceId.match(/^doc:([A-Za-z0-9]+):page:([0-9]+)$/);
  if (!match) return null;
  return { href: `/admin/source-docs/${match[1]}`, label: `p.${match[2]}` };
}

function ProvenanceChips({ provenance }: { provenance: string[] }) {
  return (
    <Box className="flex-row flex-wrap gap-1">
      {provenance.map((p) => {
        const link = provenanceLink(p);
        return link ? (
          <Link key={p} href={link.href}>
            <Text className="text-primary text-xs">{link.label}</Text>
          </Link>
        ) : (
          <Text key={p} className="text-muted-foreground text-xs">
            {p}
          </Text>
        );
      })}
    </Box>
  );
}

function ClaimClassChip({ claimClass }: { claimClass: string }) {
  return (
    <Box className="bg-background border border-border rounded-full px-2 py-0.5">
      <Text className="text-xs text-muted-foreground">
        {claimClass.replace("_", " ")}
      </Text>
    </Box>
  );
}

function ConceptCard({
  concept,
  facts,
}: {
  concept: ConceptBody;
  facts: FactBody[];
}) {
  return (
    <Box className="border border-border rounded-lg p-3 gap-2">
      <Box className="flex-row justify-between items-start gap-2">
        <Box className="flex-1 gap-0.5">
          <Text className="font-semibold">{concept.title}</Text>
          {concept.summary ? (
            <Text className="text-sm text-muted-foreground">
              {concept.summary}
            </Text>
          ) : null}
        </Box>
        <ProvenanceChips provenance={concept.pageProvenance} />
      </Box>
      {facts.map((fact, index) => (
        <Box
          key={`${concept.key}-${index}`}
          className={`rounded-lg p-2 gap-1 ${
            fact.excluded
              ? "bg-background opacity-50"
              : fact.flagged
                ? "bg-destructive/10 border border-destructive"
                : "bg-background"
          }`}
        >
          <Text className="text-sm">{fact.statement}</Text>
          <Box className="flex-row flex-wrap gap-2 items-center">
            <ClaimClassChip claimClass={fact.claimClass} />
            {fact.sourceLabel ? (
              <Text className="text-xs text-muted-foreground">
                {fact.sourceLabel}
                {fact.year ? ` (${fact.year})` : ""}
              </Text>
            ) : null}
            {fact.flagged ? (
              <Text className="text-xs text-destructive font-semibold">
                ⚑ {fact.flagReason ?? "flagged"}
              </Text>
            ) : null}
            {fact.excluded ? (
              <Text className="text-xs text-muted-foreground">excluded</Text>
            ) : null}
            <ProvenanceChips provenance={fact.provenance} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}
