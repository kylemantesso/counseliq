"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "solito/navigation";
import {
  Box,
  Button,
  ButtonText,
  Heading,
  Input,
  InputField,
  Pressable,
  ScrollView,
  Text,
} from "@counseliq/ui";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { CardStaticPreview } from "../components/card-static-preview";
import { Screen } from "../components/screen";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";

/**
 * Gate 2 — course review. The compiled course IS the review surface: module
 * → unit tree with QA chips on the left; narration with judge provenance
 * markers, cards, questions, and the anchor on the right. Actions: approve
 * the gate, send selected units back for re-authoring, edit or regenerate
 * individual questions.
 */
export function AdminGateTwoReviewScreen() {
  return (
    <AdminGuard>
      <AdminGateTwoReviewContent />
    </AdminGuard>
  );
}

// --- Shapes stored in schemaless columns (meta / qa / body) ---

interface NarrationSentence {
  id: string;
  text: string;
}

interface UnitCard {
  template: string;
  props: Record<string, unknown>;
  enterAt: { narration: string; word: string };
  provenance: string;
}

interface UnitMeta {
  secondsBudget: number;
  hook: { type: string; questionRef: string };
  retrieve: string[];
  anchor: { template: string; props: Record<string, unknown> };
  conceptKey?: string;
  order: { module: number; unit: number };
}

interface JudgeFlag {
  code: string;
  severity: "warning" | "error";
  message: string;
}

interface SentenceClassification {
  narrationId: string;
  classification: "traced" | "derived" | "unsupported";
  refs: string[];
  note: string | null;
}

interface UnitQa {
  flags: JudgeFlag[];
  sentenceClassifications: SentenceClassification[];
  judgeModel?: string;
}

interface CourseQa {
  pass: boolean;
  courseFlags: JudgeFlag[];
  errorCount: number;
  warningCount: number;
  judgeModel?: string;
}

interface QuestionBody {
  id: string;
  conceptTag: string;
  type: "commit" | "mcq";
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

function AdminGateTwoReviewContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const runId = params?.id as Id<"runs"> | undefined;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<Id<"microUnits"> | null>(
    null
  );
  const [sendBackIds, setSendBackIds] = useState<Set<Id<"microUnits">>>(
    new Set()
  );

  const runResult = useQuery(
    api.pipeline.queries.getRun,
    runId ? { runId } : "skip"
  );
  const courseData = useQuery(
    api.pipeline.courses.getRunCourse,
    runId ? { runId } : "skip"
  );
  const decideGate = useMutation(api.pipeline.runs.adminDecideGate);
  const sendBack = useMutation(api.pipeline.runs.adminSendBackForReauthoring);

  const run = runResult?.run;
  const atGate = run?.state === "GATE_2_COURSE_REVIEW";
  const units = useMemo(() => courseData?.units ?? [], [courseData]);
  const questionsById = useMemo(() => {
    const map = new Map<string, Doc<"questions">>();
    for (const row of courseData?.questions ?? []) {
      map.set((row.body as QuestionBody).id, row);
    }
    return map;
  }, [courseData]);

  const modules = useMemo(() => {
    const grouped: Array<{ moduleKey: string; title: string; units: Doc<"microUnits">[] }> = [];
    for (const unit of units) {
      let entry = grouped.find((m) => m.moduleKey === unit.moduleKey);
      if (!entry) {
        entry = {
          moduleKey: unit.moduleKey,
          title: unit.moduleTitle ?? unit.moduleKey,
          units: [],
        };
        grouped.push(entry);
      }
      entry.units.push(unit);
    }
    return grouped;
  }, [units]);

  const selectedUnit =
    units.find((unit) => unit._id === selectedUnitId) ?? units[0] ?? null;
  const courseQa = courseData?.course.qa as CourseQa | undefined;

  const onApprove = async () => {
    if (!runId) return;
    setError(null);
    setBusy(true);
    try {
      await decideGate({ runId, gate: 2, decision: "approve" });
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Gate decision failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const onSendBack = async () => {
    if (!runId || sendBackIds.size === 0) return;
    setError(null);
    setBusy(true);
    try {
      await sendBack({ runId, unitIds: [...sendBackIds] });
      setSendBackIds(new Set());
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Send-back failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const toggleSendBack = (unitId: Id<"microUnits">) => {
    setSendBackIds((current) => {
      const next = new Set(current);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  return (
    <Screen className="flex-1 flex-col bg-background">
      <Box className="bg-card border-b border-border px-6 py-4 flex-row justify-between items-center">
        <Heading size="md">Gate 2 — course review</Heading>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <ButtonText>Back</ButtonText>
        </Button>
      </Box>

      {runResult === undefined || courseData === undefined ? (
        <Box className="p-6">
          <Text>Loading...</Text>
        </Box>
      ) : !run ? (
        <Box className="p-6">
          <Text className="text-muted-foreground">Run not found.</Text>
        </Box>
      ) : !courseData ? (
        <Box className="p-6">
          <Text className="text-muted-foreground">
            No compiled course on this run yet.
          </Text>
        </Box>
      ) : (
        <>
          <Box className="bg-card border-b border-border px-6 py-3 gap-2">
            <Box className="flex-row flex-wrap gap-3 items-center">
              <Text className="font-semibold">
                {courseData.course.title} · v{courseData.course.version}
              </Text>
              <Text className="text-xs text-muted-foreground">
                run state: {run.state}
              </Text>
              {courseQa ? (
                <QaVerdictChip qa={courseQa} />
              ) : (
                <Text className="text-xs text-muted-foreground">
                  not judged yet
                </Text>
              )}
              <Box className="flex-1" />
              <Button
                size="sm"
                onPress={onApprove}
                disabled={!atGate || busy}
              >
                <ButtonText>Approve gate 2</ButtonText>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onPress={onSendBack}
                disabled={!atGate || busy || sendBackIds.size === 0}
              >
                <ButtonText>
                  {sendBackIds.size > 0
                    ? `Send ${sendBackIds.size} unit(s) back`
                    : "Send back (select units)"}
                </ButtonText>
              </Button>
            </Box>
            {courseQa && courseQa.courseFlags.length > 0 ? (
              <Box className="gap-0.5">
                {courseQa.courseFlags.map((flag, index) => (
                  <FlagRow key={`course-flag-${index}`} flag={flag} />
                ))}
              </Box>
            ) : null}
            {error ? (
              <Text className="text-destructive text-sm">{error}</Text>
            ) : null}
            {!atGate ? (
              <Text className="text-muted-foreground text-xs">
                The run is not waiting at gate 2 — actions are disabled.
              </Text>
            ) : null}
          </Box>

          <Box className="flex-1 flex-row">
            <ScrollView className="w-72 border-r border-border">
              <Box className="p-3 gap-3">
                {modules.map((module) => (
                  <Box key={module.moduleKey} className="gap-1">
                    <Text className="text-xs font-semibold text-muted-foreground uppercase">
                      {module.title}
                    </Text>
                    {module.units.map((unit) => (
                      <UnitRailRow
                        key={unit._id}
                        unit={unit}
                        selected={selectedUnit?._id === unit._id}
                        markedForSendBack={sendBackIds.has(unit._id)}
                        onSelect={() => setSelectedUnitId(unit._id)}
                        onToggleSendBack={() => toggleSendBack(unit._id)}
                      />
                    ))}
                  </Box>
                ))}
              </Box>
            </ScrollView>

            <ScrollView className="flex-1">
              {selectedUnit && runId ? (
                <UnitDetail
                  unit={selectedUnit}
                  runId={runId}
                  questionsById={questionsById}
                  onError={setError}
                />
              ) : (
                <Box className="p-6">
                  <Text className="text-muted-foreground">No units.</Text>
                </Box>
              )}
            </ScrollView>
          </Box>
        </>
      )}
    </Screen>
  );
}

function qaCounts(qa: UnitQa | undefined) {
  const flags = qa?.flags ?? [];
  return {
    errors: flags.filter((f) => f.severity === "error").length,
    warnings: flags.filter((f) => f.severity === "warning").length,
    judged: qa !== undefined,
  };
}

function UnitRailRow({
  unit,
  selected,
  markedForSendBack,
  onSelect,
  onToggleSendBack,
}: {
  unit: Doc<"microUnits">;
  selected: boolean;
  markedForSendBack: boolean;
  onSelect: () => void;
  onToggleSendBack: () => void;
}) {
  const { errors, warnings, judged } = qaCounts(unit.qa as UnitQa | undefined);
  return (
    <Box
      className={`flex-row items-center gap-2 rounded-lg px-2 py-1.5 ${
        selected ? "bg-primary/10 border border-primary" : "border border-transparent"
      }`}
    >
      <Pressable className="flex-1" onPress={onSelect}>
        <Text className="text-sm" numberOfLines={1}>
          {unit.unitKey}
        </Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {unit.concept}
        </Text>
      </Pressable>
      {!judged ? (
        <Text className="text-xs text-muted-foreground">—</Text>
      ) : errors > 0 ? (
        <Box className="bg-destructive rounded-full px-1.5 py-0.5">
          <Text className="text-xs text-white">{errors}✕</Text>
        </Box>
      ) : warnings > 0 ? (
        <Box className="bg-background border border-border rounded-full px-1.5 py-0.5">
          <Text className="text-xs text-muted-foreground">{warnings}⚠</Text>
        </Box>
      ) : (
        <Text className="text-xs text-primary">✓</Text>
      )}
      <Pressable
        onPress={onToggleSendBack}
        className={`w-5 h-5 rounded border items-center justify-center ${
          markedForSendBack ? "bg-destructive border-destructive" : "border-border"
        }`}
      >
        {markedForSendBack ? (
          <Text className="text-xs text-white">↩</Text>
        ) : null}
      </Pressable>
    </Box>
  );
}

function QaVerdictChip({ qa }: { qa: CourseQa }) {
  return qa.pass ? (
    <Box className="bg-primary/10 border border-primary rounded-full px-2 py-0.5">
      <Text className="text-xs text-primary font-semibold">QA passed</Text>
    </Box>
  ) : (
    <Box className="bg-destructive/10 border border-destructive rounded-full px-2 py-0.5">
      <Text className="text-xs text-destructive font-semibold">
        QA flagged · {qa.errorCount} error(s), {qa.warningCount} warning(s)
      </Text>
    </Box>
  );
}

function FlagRow({ flag }: { flag: JudgeFlag }) {
  return (
    <Text
      className={`text-xs ${
        flag.severity === "error" ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {flag.severity === "error" ? "✕" : "⚠"} {flag.code}: {flag.message}
    </Text>
  );
}

const CLASSIFICATION_STYLES: Record<
  SentenceClassification["classification"],
  { row: string; label: string }
> = {
  traced: { row: "border-l-2 border-primary pl-2", label: "traced" },
  derived: { row: "border-l-2 border-border pl-2", label: "derived" },
  unsupported: {
    row: "border-l-2 border-destructive pl-2 bg-destructive/10",
    label: "UNSUPPORTED",
  },
};

function UnitDetail({
  unit,
  runId,
  questionsById,
  onError,
}: {
  unit: Doc<"microUnits">;
  runId: Id<"runs">;
  questionsById: Map<string, Doc<"questions">>;
  onError: (message: string | null) => void;
}) {
  const meta = unit.meta as UnitMeta;
  const qa = unit.qa as UnitQa | undefined;
  const narration = (unit.narration ?? []) as NarrationSentence[];
  const cards = (unit.cards ?? []) as UnitCard[];
  const classificationById = new Map(
    (qa?.sentenceClassifications ?? []).map((entry) => [
      entry.narrationId,
      entry,
    ])
  );
  const hookRow = questionsById.get(meta.hook.questionRef);
  const retrieveRows = meta.retrieve
    .map((ref) => questionsById.get(ref))
    .filter((row): row is Doc<"questions"> => row !== undefined);

  return (
    <Box className="p-6 gap-4">
      <Box className="gap-1">
        <Heading size="sm">{unit.unitKey}</Heading>
        <Text className="text-sm text-muted-foreground">
          concept: {unit.concept} · {meta.secondsBudget}s budget · state:{" "}
          {unit.state}
        </Text>
      </Box>

      {qa && qa.flags.length > 0 ? (
        <Box className="bg-card border border-border rounded-xl p-3 gap-1">
          <Text className="text-xs font-semibold uppercase text-muted-foreground">
            Judge flags
          </Text>
          {qa.flags.map((flag, index) => (
            <FlagRow key={`unit-flag-${index}`} flag={flag} />
          ))}
        </Box>
      ) : null}

      {hookRow ? (
        <Box className="gap-1">
          <Text className="text-xs font-semibold uppercase text-muted-foreground">
            Hook (commit question)
          </Text>
          <QuestionCard row={hookRow} runId={runId} onError={onError} />
        </Box>
      ) : null}

      <Box className="gap-1">
        <Text className="text-xs font-semibold uppercase text-muted-foreground">
          Narration{qa ? " — judge classification per sentence" : ""}
        </Text>
        <Box className="bg-card border border-border rounded-xl p-3 gap-2">
          {narration.map((sentence) => {
            const classification = classificationById.get(sentence.id);
            const style = classification
              ? CLASSIFICATION_STYLES[classification.classification]
              : null;
            return (
              <Box key={sentence.id} className={style?.row ?? "pl-2"}>
                <Text className="text-sm">{sentence.text}</Text>
                <Text className="text-xs text-muted-foreground">
                  {sentence.id}
                  {classification ? ` · ${style?.label}` : ""}
                  {classification && classification.refs.length > 0
                    ? ` · ${classification.refs.join("; ")}`
                    : ""}
                  {classification?.note ? ` · ${classification.note}` : ""}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box className="gap-1">
        <Text className="text-xs font-semibold uppercase text-muted-foreground">
          Cards ({cards.length})
        </Text>
        <Box className="flex-row flex-wrap gap-3">
          {cards.map((card, index) => (
            <Box key={`card-${index}`} className="w-56 gap-1">
              <Text className="text-xs font-semibold">
                {index + 1}. {card.template}
              </Text>
              <CardStaticPreview template={card.template} props={card.props} />
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                @ {card.enterAt.narration} “{card.enterAt.word}”
              </Text>
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                {card.provenance}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>

      <Box className="gap-1">
        <Text className="text-xs font-semibold uppercase text-muted-foreground">
          Retrieve questions
        </Text>
        {retrieveRows.map((row) => (
          <QuestionCard
            key={row._id}
            row={row}
            runId={runId}
            onError={onError}
          />
        ))}
      </Box>

      <Box className="gap-1">
        <Text className="text-xs font-semibold uppercase text-muted-foreground">
          Anchor
        </Text>
        <Box className="w-56 gap-1">
          <Text className="text-xs text-muted-foreground">
            {meta.anchor.template}
          </Text>
          <CardStaticPreview
            template={meta.anchor.template}
            props={meta.anchor.props}
          />
        </Box>
      </Box>
    </Box>
  );
}

function QuestionCard({
  row,
  runId,
  onError,
}: {
  row: Doc<"questions">;
  runId: Id<"runs">;
  onError: (message: string | null) => void;
}) {
  const body = row.body as QuestionBody;
  const updateQuestion = useMutation(api.pipeline.courses.adminUpdateQuestion);
  const regenerate = useMutation(api.pipeline.courses.adminRegenerateQuestion);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(body.prompt);
  const [options, setOptions] = useState<string[]>(body.options);
  const [correctIndex, setCorrectIndex] = useState(body.correctIndex);
  const [explanation, setExplanation] = useState(body.explanation);

  const startEditing = () => {
    setPrompt(body.prompt);
    setOptions(body.options);
    setCorrectIndex(body.correctIndex);
    setExplanation(body.explanation);
    setEditing(true);
  };

  const onSave = async () => {
    onError(null);
    setBusy(true);
    try {
      await updateQuestion({
        questionId: row._id,
        prompt,
        options,
        correctIndex,
        explanation,
      });
      setEditing(false);
    } catch (err) {
      onError(
        getUserFacingErrorMessage(
          err,
          "Could not save the question. Check every field is filled in."
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const onRegenerate = async () => {
    onError(null);
    setBusy(true);
    try {
      await regenerate({ runId, questionId: row._id });
    } catch (err) {
      onError(getUserFacingErrorMessage(err, "Regeneration failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <Box className="bg-card border border-border rounded-xl p-3 gap-1">
        <Box className="flex-row items-start gap-2">
          <Box className="flex-1 gap-0.5">
            <Text className="text-sm font-semibold">{body.prompt}</Text>
            {body.options.map((option, index) => (
              <Text
                key={`${row._id}-opt-${index}`}
                className={`text-sm ${
                  index === body.correctIndex
                    ? "text-primary font-semibold"
                    : "text-muted-foreground"
                }`}
              >
                {index === body.correctIndex ? "✓" : "○"} {option}
              </Text>
            ))}
            <Text className="text-xs text-muted-foreground">
              {body.explanation}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {body.id} · {body.type} · {body.conceptTag}
            </Text>
          </Box>
          <Box className="gap-1">
            <Button size="sm" variant="outline" onPress={startEditing} disabled={busy}>
              <ButtonText>Edit</ButtonText>
            </Button>
            <Button size="sm" variant="outline" onPress={onRegenerate} disabled={busy}>
              <ButtonText>{busy ? "…" : "Regenerate"}</ButtonText>
            </Button>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box className="bg-card border border-primary rounded-xl p-3 gap-2">
      <Input>
        <InputField
          placeholder="Prompt"
          value={prompt}
          onChangeText={setPrompt}
        />
      </Input>
      {options.map((option, index) => (
        <Box key={`${row._id}-edit-${index}`} className="flex-row gap-2 items-center">
          <Pressable
            onPress={() => setCorrectIndex(index)}
            className={`w-6 h-6 rounded-full border items-center justify-center ${
              index === correctIndex
                ? "bg-primary border-primary"
                : "border-border"
            }`}
          >
            {index === correctIndex ? (
              <Text className="text-xs text-white">✓</Text>
            ) : null}
          </Pressable>
          <Box className="flex-1">
            <Input>
              <InputField
                placeholder={`Option ${index + 1}`}
                value={option}
                onChangeText={(text) =>
                  setOptions((current) =>
                    current.map((entry, i) => (i === index ? text : entry))
                  )
                }
              />
            </Input>
          </Box>
        </Box>
      ))}
      <Input>
        <InputField
          placeholder="Explanation"
          value={explanation}
          onChangeText={setExplanation}
        />
      </Input>
      <Box className="flex-row gap-2">
        <Button size="sm" onPress={onSave} disabled={busy}>
          <ButtonText>Save</ButtonText>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={() => setEditing(false)}
          disabled={busy}
        >
          <ButtonText>Cancel</ButtonText>
        </Button>
      </Box>
    </Box>
  );
}
