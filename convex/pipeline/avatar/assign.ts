"use node";

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { completeStructured, createOpenRouterClient } from "../llm/client";
import { PROMPTS } from "../prompts";

const assignmentSchema = z.object({
  assignments: z.array(
    z.object({
      unitId: z.string().min(1),
      lookId: z.string().min(1),
      reason: z.string().min(1),
    })
  ),
});

type Assignment = z.infer<typeof assignmentSchema>["assignments"][number];
type PersistedAssignment = {
  look: {
    groupId: string;
    lookId: string;
    name: string;
    previewImageUrl?: string | null;
    preferredOrientation?: "portrait" | "landscape" | "square" | null;
    supportedEngines?: string[];
    avatarType?: "photo_avatar" | "digital_twin" | "studio_avatar";
  };
  source: "ai" | "fallback";
  reason: string;
  promptVersion?: string;
  model?: string;
  assignedAt: number;
};
type UnitRow = {
  unitKey: string;
  moduleKey: string;
  moduleTitle?: string;
  concept: string;
  narration: unknown;
};
type LookRow = {
  lookId: string;
  groupId: string;
  name: string;
  previewImageUrl?: string | null;
  preferredOrientation?: "portrait" | "landscape" | "square" | null;
  supportedEngines: string[];
  avatarType?: "photo_avatar" | "digital_twin" | "studio_avatar";
  tags: string[];
  status?: string | null;
  evaluation?: {
    description: string;
    setting: string;
    attire: string;
    framing: string;
    tone: string;
    suitableTopics: string[];
    visualTags: string[];
  };
};

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3)
  );
}

function unitText(unit: UnitRow): string {
  return [
    unit.moduleTitle ?? unit.moduleKey,
    unit.concept,
    JSON.stringify(unit.narration),
  ].join(" ");
}

function lookText(look: LookRow): string {
  return [
    look.name,
    look.tags.join(" "),
    look.evaluation?.description ?? "",
    look.evaluation?.setting ?? "",
    look.evaluation?.attire ?? "",
    look.evaluation?.tone ?? "",
    look.evaluation?.suitableTopics.join(" ") ?? "",
    look.evaluation?.visualTags.join(" ") ?? "",
  ].join(" ");
}

function scoreLook(unit: UnitRow, look: LookRow): number {
  const wanted = tokens(unitText(unit));
  let score = 0;
  for (const token of tokens(lookText(look))) {
    if (wanted.has(token)) score += 1;
  }
  if (look.preferredOrientation === "portrait") score += 0.25;
  if (look.evaluation) score += 0.5;
  return score;
}

/** Content-first deterministic fallback with variety when scores are close. */
export function fallbackAssignments(units: UnitRow[], looks: LookRow[]): Assignment[] {
  let previousLookId: string | null = null;
  return units.map((unit) => {
    const ranked = [...looks]
      .map((look) => ({ look, score: scoreLook(unit, look) }))
      .sort((a, b) => b.score - a.score || a.look.lookId.localeCompare(b.look.lookId));
    const best = ranked[0];
    const varied =
      previousLookId === best?.look.lookId
        ? ranked.find((candidate) => candidate.look.lookId !== previousLookId && candidate.score >= best.score - 1)
        : undefined;
    const selected = varied ?? best;
    previousLookId = selected.look.lookId;
    return {
      unitId: unit.unitKey,
      lookId: selected.look.lookId,
      reason:
        selected.score > 0
          ? `Fallback matched this look to the video's evaluated setting and topics (score ${selected.score}).`
          : "Fallback selected an available portrait look; review this choice before approval.",
    };
  });
}

export function validateAssignments(
  assignments: Assignment[],
  units: UnitRow[],
  looks: LookRow[]
): string | null {
  const expectedUnits = new Set(units.map((unit) => unit.unitKey));
  const allowedLooks = new Set(looks.map((look) => look.lookId));
  const seenUnits = new Set<string>();
  if (assignments.length !== units.length) {
    return `expected ${units.length} assignments, received ${assignments.length}`;
  }
  for (const assignment of assignments) {
    if (!expectedUnits.has(assignment.unitId)) return `unknown unitId ${assignment.unitId}`;
    if (!allowedLooks.has(assignment.lookId)) return `unknown lookId ${assignment.lookId}`;
    if (seenUnits.has(assignment.unitId)) return `duplicate unitId ${assignment.unitId}`;
    seenUnits.add(assignment.unitId);
  }
  for (const unitId of expectedUnits) {
    if (!seenUnits.has(unitId)) return `missing unitId ${unitId}`;
  }
  return null;
}

/** Assign a fitting, evaluated custom-avatar look to each video unit. */
export const assignUnitLooks = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<{ aiAssigned: number; fallbackAssigned: number; warning?: string }> => {
    const rows = await ctx.runQuery(internal.pipeline.courses.getCourseForRunInternal, {
      runId: args.runId,
    });
    if (!rows) return { aiAssigned: 0, fallbackAssigned: 0, warning: "course missing" };
    const presentation = (rows.course.definitionMeta as {
      presentation?: {
        mode?: string;
        avatarGroupId?: string;
        engine?: string;
        unitAssignments?: Record<string, { manuallyLocked?: boolean }>;
      };
    } | undefined)?.presentation;
    if (presentation?.mode !== "avatar" || !presentation.avatarGroupId) {
      return { aiAssigned: 0, fallbackAssigned: 0 };
    }

    await ctx.runAction(internal.pipeline.avatar.catalogue.syncAvatarCatalog, {});
    const allLooks = (await ctx.runQuery(
      internal.pipeline.avatar.catalogueData.getAvatarLooksForGroup,
      { groupId: presentation.avatarGroupId }
    )) as LookRow[];
    const looks = allLooks.filter(
      (look) =>
        (look.status === null || look.status === undefined || look.status === "completed") &&
        (!presentation.engine || look.supportedEngines.includes(presentation.engine))
    );
    if (looks.length === 0) {
      return { aiAssigned: 0, fallbackAssigned: 0, warning: "no completed compatible looks" };
    }

    const units = rows.units as UnitRow[];
    const routing = await ctx.runQuery(
      internal.pipeline.queries.getLlmModelRoutingInternal,
      {}
    );
    const prompt = [
      "Assign every video exactly once. Copy unitId and lookId exactly.",
      "Available looks:",
      ...looks.map(
        (look) =>
          `- lookId=${look.lookId}; name=${look.name}; orientation=${look.preferredOrientation ?? "unknown"}; ` +
          `evaluation=${look.evaluation ? `${look.evaluation.description}; setting=${look.evaluation.setting}; attire=${look.evaluation.attire}; framing=${look.evaluation.framing}; tone=${look.evaluation.tone}; topics=${look.evaluation.suitableTopics.join(", ")}; tags=${look.evaluation.visualTags.join(", ")}` : "not evaluated"}`
      ),
      "Videos:",
      ...units.map(
        (unit) =>
          `- unitId=${unit.unitKey}; module=${unit.moduleTitle ?? unit.moduleKey}; concept=${unit.concept}; narration=${JSON.stringify(unit.narration).slice(0, 900)}`
      ),
    ].join("\n");

    let assignments: Assignment[];
    let source: "ai" | "fallback" = "ai";
    let model: string | undefined;
    let warning: string | undefined;
    try {
      const result = await completeStructured(
        createOpenRouterClient({ modelRouting: routing }),
        "assign-avatar-look",
        {
          system: PROMPTS["assign-avatar-look"].content,
          user: [{ type: "text", text: prompt }],
          schemaName: "avatar_look_assignments",
          jsonSchema: zodToJsonSchema(assignmentSchema, {
            $refStrategy: "none",
            target: "openAi",
          }) as Record<string, unknown>,
        },
        assignmentSchema
      );
      const problem = validateAssignments(result.value.assignments, units, looks);
      if (problem) throw new Error(`invalid avatar assignment: ${problem}`);
      assignments = result.value.assignments;
      model = result.usages.at(-1)?.model ?? routing["assign-avatar-look"];
    } catch (error) {
      source = "fallback";
      warning = error instanceof Error ? error.message : String(error);
      console.warn(`[avatar] run ${args.runId}: AI assignment failed; using scored fallback (${warning})`);
      assignments = fallbackAssignments(units, looks);
    }

    const byId = new Map(looks.map((look) => [look.lookId, look]));
    const existingAssignments = presentation.unitAssignments ?? {};
    const persisted: Record<string, PersistedAssignment> = {};
    for (const assignment of assignments) {
      if (existingAssignments[assignment.unitId]?.manuallyLocked) continue;
      const look = byId.get(assignment.lookId)!;
      persisted[assignment.unitId] = {
        look: {
          groupId: look.groupId,
          lookId: look.lookId,
          name: look.name,
          previewImageUrl: look.previewImageUrl ?? null,
          preferredOrientation: look.preferredOrientation ?? null,
          supportedEngines: look.supportedEngines,
          ...(look.avatarType ? { avatarType: look.avatarType } : {}),
        },
        source,
        reason: assignment.reason,
        ...(source === "ai"
          ? {
              promptVersion: PROMPTS["assign-avatar-look"].versionTag,
              model,
            }
          : {}),
        assignedAt: Date.now(),
      };
    }
    await ctx.runMutation(internal.pipeline.avatar.jobs.saveUnitLookAssignments, {
      runId: args.runId,
      assignments: persisted,
    });
    return {
      aiAssigned: source === "ai" ? Object.keys(persisted).length : 0,
      fallbackAssigned: source === "fallback" ? Object.keys(persisted).length : 0,
      ...(warning ? { warning } : {}),
    };
  },
});
