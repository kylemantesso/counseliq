/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  ALLOWED_TRANSITIONS,
  GATE_STATES,
  isTransitionAllowed,
} from "./pipeline/states";

const modules = import.meta.glob("./**/*.ts");

async function setupRun(
  state:
    | "EXTRACTED"
    | "GATE_1_KNOWLEDGE_REVIEW"
    | "QA_RUNNING"
    | "GATE_2_COURSE_REVIEW"
) {
  const t = convexTest(schema, modules);
  const runId = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "Test University",
      brandTokens: {},
      pronunciationLexicon: {},
      market: "AU",
    });
    return await ctx.db.insert("runs", {
      institutionId,
      state,
      promptVersions: {},
    });
  });
  return { t, runId: runId as Id<"runs"> };
}

describe("M4 state machine resequencing", () => {
  test("EXTRACTED goes to GATE_1 before compilation", () => {
    expect(ALLOWED_TRANSITIONS.EXTRACTED).toEqual(["GATE_1_KNOWLEDGE_REVIEW"]);
    // M6.5: gate-1 approval routes to the outline pass; the direct
    // COMPILING edge stays legal for legacy runs mid-flight.
    expect(ALLOWED_TRANSITIONS.GATE_1_KNOWLEDGE_REVIEW).toEqual([
      "OUTLINING",
      "COMPILING",
    ]);
  });

  test("M6.5: outline parks for review; approve compiles, regenerate loops", () => {
    expect(ALLOWED_TRANSITIONS.OUTLINING).toEqual(["OUTLINE_REVIEW"]);
    expect(ALLOWED_TRANSITIONS.OUTLINE_REVIEW).toEqual(["COMPILING", "OUTLINING"]);
    // The outline step cannot skip straight to asset generation.
    expect(isTransitionAllowed("OUTLINE_REVIEW", "GENERATING_SCRIPT")).toBe(false);
  });

  test("QA judge runs on the compiled course, before gate 2 and asset generation", () => {
    expect(ALLOWED_TRANSITIONS.COMPILED).toEqual(["QA_RUNNING"]);
    expect(ALLOWED_TRANSITIONS.QA_RUNNING).toEqual(["QA_PASSED", "QA_FLAGGED"]);
    expect(ALLOWED_TRANSITIONS.QA_PASSED).toEqual(["GATE_2_COURSE_REVIEW"]);
    expect(ALLOWED_TRANSITIONS.QA_FLAGGED).toEqual(["GATE_2_COURSE_REVIEW"]);
    // Asset generation only starts after the course review gate.
    expect(isTransitionAllowed("COMPILED", "GENERATING_SCRIPT")).toBe(false);
    expect(isTransitionAllowed("QA_PASSED", "GENERATING_SCRIPT")).toBe(false);
  });

  test("gate 2 is the course review and can send back to COMPILING or forward to assets", () => {
    expect(GATE_STATES[2]).toBe("GATE_2_COURSE_REVIEW");
    expect(ALLOWED_TRANSITIONS.GATE_2_COURSE_REVIEW).toEqual([
      "GENERATING_SCRIPT",
      "COMPILING",
    ]);
  });

  test("old shortcut EXTRACTED -> COMPILING is illegal", async () => {
    const { t, runId } = await setupRun("EXTRACTED");
    await expect(
      t.mutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "COMPILING",
        actor: "test",
      })
    ).rejects.toThrow(/RUN_TRANSITION_INVALID/);
  });

  test("QA_FLAGGED routes to gate 2, not FAILED-only", async () => {
    const { t, runId } = await setupRun("QA_RUNNING");
    await t.mutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "QA_FLAGGED",
      actor: "test",
    });
    await t.mutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "GATE_2_COURSE_REVIEW",
      actor: "test",
    });
    const { run } = await t.query(internal.pipeline.queries.getRunInternal, {
      runId,
    });
    expect(run?.state).toBe("GATE_2_COURSE_REVIEW");
  });

  test("gate 1 approval path starts the compile workflow", async () => {
    const { t, runId } = await setupRun("GATE_1_KNOWLEDGE_REVIEW");
    // Getting past the gate checks to the workflow start (whose component is
    // not registered in convex-test) proves approval routes to COMPILING.
    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 1,
        decision: "approve",
      })
    ).rejects.toThrow(/Component "workflow" is not registered/);
  });

  test("gate 2 approval path starts asset generation", async () => {
    const { t, runId } = await setupRun("GATE_2_COURSE_REVIEW");
    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 2,
        decision: "approve",
      })
    ).rejects.toThrow(/Component "workflow" is not registered/);
  });

  test("gate 2 send-back validates units and re-runs the compile workflow", async () => {
    const { t, runId } = await setupRun("GATE_2_COURSE_REVIEW");
    const { unitId, strayUnitId } = await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const courseId = await ctx.db.insert("courses", {
        institutionId: run!.institutionId,
        title: "Test course",
        level: 3,
        version: 1,
        status: "in_review",
      });
      await ctx.db.patch(runId, { courseId });
      const unitId = await ctx.db.insert("microUnits", {
        courseId,
        moduleKey: "m1",
        unitKey: "mu-101",
        concept: "campuses",
        narration: [],
        cards: [],
        state: "draft",
      });
      const otherCourseId = await ctx.db.insert("courses", {
        institutionId: run!.institutionId,
        title: "Other course",
        level: 3,
        version: 1,
        status: "in_review",
      });
      const strayUnitId = await ctx.db.insert("microUnits", {
        courseId: otherCourseId,
        moduleKey: "m1",
        unitKey: "mu-999",
        concept: "other",
        narration: [],
        cards: [],
        state: "draft",
      });
      await ctx.db.insert("users", {
        tokenIdentifier: "https://convex.test|admin",
        name: "Admin",
        email: "admin@test.dev",
        createdAt: Date.now(),
        isAdmin: true,
      });
      return { unitId, strayUnitId };
    });
    const asAdmin = t.withIdentity({ subject: "admin" });

    // Empty selection and foreign units are rejected before any transition.
    await expect(
      asAdmin.mutation(api.pipeline.runs.adminSendBackForReauthoring, {
        runId,
        unitIds: [],
      })
    ).rejects.toThrow(/UNITS_REQUIRED/);
    await expect(
      asAdmin.mutation(api.pipeline.runs.adminSendBackForReauthoring, {
        runId,
        unitIds: [strayUnitId],
      })
    ).rejects.toThrow(/UNITS_REQUIRED/);

    // A valid selection gets past validation + the COMPILING transition to
    // the workflow start (component not registered in convex-test).
    await expect(
      asAdmin.mutation(api.pipeline.runs.adminSendBackForReauthoring, {
        runId,
        unitIds: [unitId],
      })
    ).rejects.toThrow(/Component "workflow" is not registered/);
  });
});
