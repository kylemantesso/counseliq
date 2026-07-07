/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  assembleCourseDefinition,
  type AuthoredUnitWithPlan,
} from "./pipeline/compiler/assemble";
import { definitionToWire } from "./pipeline/courses";

const modules = import.meta.glob("./**/*.ts");

async function seedRunWithInventory() {
  const t = convexTest(schema, modules);
  const { runId } = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "Deakin University",
      brandTokens: {},
      pronunciationLexicon: { Geelong: "juh-LONG" },
      market: "AU",
    });
    const runId = await ctx.db.insert("runs", {
      institutionId,
      state: "COMPILING",
      promptVersions: {},
    });
    await ctx.db.insert("inventoryItems", {
      runId,
      kind: "concept",
      body: {
        type: "concept",
        key: "campuses",
        title: "Campus network",
        summary: "Where Deakin operates.",
        pageProvenance: ["doc:abc123:page:2"],
      },
      provenance: ["doc:abc123:page:2"],
      flagged: false,
    });
    await ctx.db.insert("inventoryItems", {
      runId,
      kind: "fact",
      body: {
        type: "fact",
        conceptKey: "campuses",
        statement: "Deakin has five campuses.",
        claimClass: "structural",
        provenance: ["doc:abc123:page:2"],
        flagged: false,
      },
      claimClass: "structural",
      provenance: ["doc:abc123:page:2"],
      flagged: false,
    });
    await ctx.db.insert("inventoryItems", {
      runId,
      kind: "fact",
      body: {
        type: "fact",
        conceptKey: "campuses",
        statement: "An unverified claim about 99,999 students.",
        claimClass: "statistic",
        provenance: ["doc:abc123:page:3"],
        flagged: true,
        flagReason: "missing-source-or-year",
        excluded: true,
      },
      claimClass: "statistic",
      provenance: ["doc:abc123:page:3"],
      flagged: true,
      flagReason: "missing-source-or-year",
      excluded: true,
    });
    return { runId };
  });
  return { t, runId: runId as Id<"runs"> };
}

function makeUnit(unitId: string, hookPrompt: string): AuthoredUnitWithPlan {
  return {
    plan: {
      unitId,
      conceptKey: "campuses",
      conceptTag: "campuses",
      title: "Campus network",
      secondsBudget: 45,
      moduleId: "m1-why-deakin",
      moduleTitle: "Why Deakin",
    },
    authored: {
      narration: [
        { id: "n1", text: `About unit ${unitId}: five campuses in Victoria.` },
      ],
      cards: [
        {
          template: "map-card",
          props: { region: "Victoria" },
          enterAt: { narration: "n1", word: "campuses" },
          provenance: "doc:abc123:page:2",
        },
      ],
      hookQuestion: {
        prompt: hookPrompt,
        options: ["Three", "Five"],
        correctIndex: 1,
        explanation: "Five campuses.",
      },
      retrieveQuestions: [
        {
          prompt: `Retrieve A for ${unitId}?`,
          options: ["Yes", "No"],
          correctIndex: 0,
          explanation: "Yes.",
        },
        {
          prompt: `Retrieve B for ${unitId}?`,
          options: ["Yes", "No"],
          correctIndex: 0,
          explanation: "Yes.",
        },
      ],
      anchor: {
        template: "takeaway-card",
        props: { text: "Five campuses." },
      },
    },
  };
}

function makeDefinition(courseTitle: string) {
  return assembleCourseDefinition({
    courseTitle,
    institutionName: "Deakin University",
    pronunciationLexicon: { Geelong: "juh-LONG" },
    excludedFacts: [],
    moduleOrder: [{ moduleId: "m1-why-deakin", title: "Why Deakin" }],
    units: [makeUnit("mu-101", "How many campuses?"), makeUnit("mu-102", "Largest campus?")],
  });
}

describe("reviewed inventory (compiler input)", () => {
  test("excluded facts are filtered out and provenance ids collected", async () => {
    const { t, runId } = await seedRunWithInventory();
    const inventory = await t.query(
      internal.pipeline.courses.getReviewedInventoryInternal,
      { runId }
    );
    expect(inventory.concepts).toHaveLength(1);
    expect(inventory.facts).toHaveLength(1);
    expect(inventory.facts[0].statement).toBe("Deakin has five campuses.");
    expect(inventory.excludedFacts).toHaveLength(1);
    expect(inventory.excludedFacts[0].statement).toContain("99,999");
    expect(inventory.provenanceIds.sort()).toEqual([
      "doc:abc123:page:2",
      "doc:abc123:page:3",
    ]);
  });
});

describe("saveCompiledCourse persistence", () => {
  test("writes courses/microUnits/questions and links runs.courseId", async () => {
    const { t, runId } = await seedRunWithInventory();
    const { definition, conceptKeysByUnitId } = makeDefinition("Deakin Essentials");

    const saved = await t.mutation(
      internal.pipeline.courses.saveCompiledCourse,
      { runId, definition: definitionToWire(definition), conceptKeysByUnitId }
    );
    expect(saved.unitCount).toBe(2);
    expect(saved.moduleCount).toBe(1);
    expect(saved.questionCount).toBe(6);

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.courseId).toBe(saved.courseId);
      const course = await ctx.db.get(saved.courseId);
      expect(course?.title).toBe("Deakin Essentials");
      expect(course?.version).toBe(1);
      expect(course?.status).toBe("in_review");
      const units = await ctx.db
        .query("microUnits")
        .withIndex("by_course", (q) => q.eq("courseId", saved.courseId))
        .collect();
      expect(units.map((u) => u.unitKey).sort()).toEqual(["mu-101", "mu-102"]);
      expect(units[0].moduleTitle).toBe("Why Deakin");
    });
  });

  test("the definition round-trips losslessly through the database", async () => {
    const { t, runId } = await seedRunWithInventory();
    const { definition, conceptKeysByUnitId } = makeDefinition("Deakin Essentials");
    await t.mutation(internal.pipeline.courses.saveCompiledCourse, {
      runId,
      definition: definitionToWire(definition),
      conceptKeysByUnitId,
    });
    const reconstructed = await t.query(
      internal.pipeline.courses.getCourseDefinitionForRunInternal,
      { runId }
    );
    expect(reconstructed).toEqual(definitionToWire(definition));
  });

  test("recompiling replaces rows and bumps the version", async () => {
    const { t, runId } = await seedRunWithInventory();
    const first = makeDefinition("Deakin Essentials");
    const saved1 = await t.mutation(
      internal.pipeline.courses.saveCompiledCourse,
      {
        runId,
        definition: definitionToWire(first.definition),
        conceptKeysByUnitId: first.conceptKeysByUnitId,
      }
    );
    const second = makeDefinition("Deakin Essentials v2");
    const saved2 = await t.mutation(
      internal.pipeline.courses.saveCompiledCourse,
      {
        runId,
        definition: definitionToWire(second.definition),
        conceptKeysByUnitId: second.conceptKeysByUnitId,
      }
    );
    expect(saved2.courseId).toBe(saved1.courseId);

    await t.run(async (ctx) => {
      const course = await ctx.db.get(saved2.courseId);
      expect(course?.version).toBe(2);
      expect(course?.title).toBe("Deakin Essentials v2");
      const units = await ctx.db
        .query("microUnits")
        .withIndex("by_course", (q) => q.eq("courseId", saved2.courseId))
        .collect();
      expect(units).toHaveLength(2);
      const questions = await ctx.db
        .query("questions")
        .withIndex("by_course", (q) => q.eq("courseId", saved2.courseId))
        .collect();
      expect(questions).toHaveLength(6);
    });
  });
});

describe("unit authoring cache", () => {
  test("upsert and cache-key mismatch behaviour", async () => {
    const { t, runId } = await seedRunWithInventory();
    await t.mutation(internal.pipeline.courses.saveUnitAuthoring, {
      runId,
      unitId: "mu-101",
      cacheKey: "k1",
      result: { status: "ok", marker: 1 },
    });
    const hit = await t.query(internal.pipeline.courses.getUnitAuthoring, {
      runId,
      unitId: "mu-101",
      cacheKey: "k1",
    });
    expect(hit).toEqual({ status: "ok", marker: 1 });

    const miss = await t.query(internal.pipeline.courses.getUnitAuthoring, {
      runId,
      unitId: "mu-101",
      cacheKey: "k2",
    });
    expect(miss).toBeNull();

    // Upsert replaces the row rather than duplicating it.
    await t.mutation(internal.pipeline.courses.saveUnitAuthoring, {
      runId,
      unitId: "mu-101",
      cacheKey: "k2",
      result: { status: "ok", marker: 2 },
    });
    const rows = await t.query(
      internal.pipeline.courses.listUnitAuthoringsForRun,
      { runId }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toEqual({ status: "ok", marker: 2 });
  });
});
