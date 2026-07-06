/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupRun(state: "UPLOADED" | "GATE_1_KNOWLEDGE_REVIEW") {
  const t = convexTest(schema, modules);
  const { institutionId, runId } = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "Test University",
      brandTokens: {},
      pronunciationLexicon: {},
      market: "AU",
    });
    const runId = await ctx.db.insert("runs", {
      institutionId,
      state,
      promptVersions: {},
    });
    return { institutionId, runId };
  });
  return { t, institutionId, runId: runId as Id<"runs"> };
}

describe("transitionRun", () => {
  test("legal transition updates state and writes a runEvent", async () => {
    const { t, runId } = await setupRun("UPLOADED");

    await t.mutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "EXTRACTING",
      actor: "test",
      detail: "test transition",
    });

    const { run, events } = await t.query(
      internal.pipeline.queries.getRunInternal,
      { runId }
    );

    expect(run?.state).toBe("EXTRACTING");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      runId,
      fromState: "UPLOADED",
      toState: "EXTRACTING",
      actor: "test",
      detail: "test transition",
    });
  });

  test("illegal transition (UPLOADED -> PUBLISHED) throws and writes nothing", async () => {
    const { t, runId } = await setupRun("UPLOADED");

    await expect(
      t.mutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "PUBLISHED",
        actor: "test",
      })
    ).rejects.toThrow(/RUN_TRANSITION_INVALID/);

    const { run, events } = await t.query(
      internal.pipeline.queries.getRunInternal,
      { runId }
    );
    expect(run?.state).toBe("UPLOADED");
    expect(events).toHaveLength(0);
  });

  test("any state may fail, but FAILED is terminal", async () => {
    const { t, runId } = await setupRun("UPLOADED");

    await t.mutation(internal.pipeline.transitions.transitionRun, {
      runId,
      toState: "FAILED",
      actor: "test",
      error: { retryable: true, cause: "test failure" },
    });

    const { run } = await t.query(internal.pipeline.queries.getRunInternal, {
      runId,
    });
    expect(run?.state).toBe("FAILED");
    expect(run?.error).toEqual({ retryable: true, cause: "test failure" });

    await expect(
      t.mutation(internal.pipeline.transitions.transitionRun, {
        runId,
        toState: "FAILED",
        actor: "test",
      })
    ).rejects.toThrow(/RUN_TRANSITION_INVALID/);
  });
});

describe("decideGate", () => {
  test("refuses when the run is not at the requested gate", async () => {
    const { t, runId } = await setupRun("UPLOADED");

    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 1,
        decision: "approve",
      })
    ).rejects.toThrow(/RUN_NOT_AT_GATE/);

    const { run } = await t.query(internal.pipeline.queries.getRunInternal, {
      runId,
    });
    expect(run?.state).toBe("UPLOADED");
  });

  test("reject at gate 1 fails the run with a retryable error", async () => {
    const { t, runId } = await setupRun("GATE_1_KNOWLEDGE_REVIEW");

    await t.mutation(internal.pipeline.runs.decideGate, {
      runId,
      gate: 1,
      decision: "reject",
      reviewer: "test-reviewer",
    });

    const { run, events } = await t.query(
      internal.pipeline.queries.getRunInternal,
      { runId }
    );
    expect(run?.state).toBe("FAILED");
    expect(run?.error).toEqual({ retryable: true, cause: "gate 1 rejected" });
    expect(events.at(-1)).toMatchObject({
      fromState: "GATE_1_KNOWLEDGE_REVIEW",
      toState: "FAILED",
      actor: "test-reviewer",
    });
  });
});
