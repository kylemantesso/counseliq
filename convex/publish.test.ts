/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { parseCourseDefinition } from "@counseliq/course-schema";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeAll(() => {
  process.env.TTS_PROVIDER = "mock";
  process.env.TTS_MODE = "sequential";
});

/**
 * Seeds a run at GATE_3_PREVIEW whose course reconstructs into a fully valid
 * CourseDefinition, with real (mock-provider) timing artifacts on every unit
 * — the shape finalizePublish freezes.
 */
async function seedPublishable() {
  const t = convexTest(schema, modules);
  const lexicon: Record<string, string> = { Geelong: "juh-LONG" };

  const ids = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "La Trobe University",
      brandTokens: { placeholder: true },
      pronunciationLexicon: lexicon,
      market: "AU",
    });
    const courseId = await ctx.db.insert("courses", {
      institutionId,
      title: "La Trobe Essentials",
      level: 1,
      version: 1,
      status: "in_review",
      definitionMeta: {
        schemaRef: "counseliq://course-definition/v1",
        courseId: "latrobe-essentials",
        badge: "Explorer",
        prerequisite: "none",
        brandRef: "latrobe",
        language: "en-AU",
        voice: {
          provider: "elevenlabs",
          voiceRef: "latrobe-narrator-01",
          pronunciationLexicon: lexicon,
        },
        _pipelineNotes: {
          withheldFacts: [],
          verificationFlags: [],
          assessmentGate: "roleplay-consultation",
        },
        assessment: {
          type: "roleplay-consultation",
          scenarioRef: "rp-health-amara-01",
          description: "Advise a prospective student.",
          passRubricThreshold: 0.8,
          mcqFallback: false,
        },
      },
    });
    const runId = await ctx.db.insert("runs", {
      institutionId,
      courseId,
      state: "GENERATING_ASSETS",
      promptVersions: { "author-unit": "author-unit@1" },
    });
    const unitId = await ctx.db.insert("microUnits", {
      courseId,
      moduleKey: "m1-welcome",
      moduleTitle: "Welcome",
      unitKey: "mu-101",
      concept: "scale",
      meta: {
        secondsBudget: 45,
        hook: { type: "commit-question", questionRef: "q1" },
        retrieve: ["q2"],
        anchor: { template: "takeaway-card", props: { text: "Scale matters." } },
        order: { module: 0, unit: 0 },
      },
      narration: [
        { id: "n1", text: "The university invested A$82M across 5 campuses." },
        { id: "n2", text: "Students arrive from 110 countries." },
      ],
      cards: [
        {
          template: "stat-card",
          props: { headline: "A$82M invested" },
          enterAt: { narration: "n1", word: "campuses" },
          provenance: "fact:1",
        },
      ],
      state: "draft" as const,
    });
    for (const question of [
      {
        id: "q1",
        conceptTag: "scale",
        type: "commit",
        prompt: "How many campuses does the university operate?",
        options: ["Two", "Five"],
        correctIndex: 1,
        explanation: "There are five campuses.",
      },
      {
        id: "q2",
        conceptTag: "scale",
        type: "mcq",
        prompt: "How many countries do students arrive from?",
        options: ["11", "110"],
        correctIndex: 1,
        explanation: "Students arrive from 110 countries.",
      },
    ]) {
      await ctx.db.insert("questions", {
        courseId,
        conceptTag: question.conceptTag,
        body: question,
      });
    }
    return { institutionId, courseId, runId, unitId };
  });

  await t.mutation(internal.pipeline.tts.script.generateScripts, {
    runId: ids.runId,
  });
  await t.action(internal.pipeline.tts.synthesize.runAssetGeneration, {
    runId: ids.runId,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.runId, { state: "GATE_3_PREVIEW" });
  });
  return { t, ...ids };
}

const FAKE_KEYS = {
  exportKey: "sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json",
  manifestKey: "sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json",
  specHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  counts: { modules: 1, units: 1, questions: 2, audioArtifacts: 2 },
};

describe("finalizePublish", () => {
  test("freezes the course: published status, specHash, unit states, snapshot row", async () => {
    const { t, runId, courseId, unitId } = await seedPublishable();

    const result = await t.mutation(
      internal.pipeline.publishedCourses.finalizePublish,
      { runId, ...FAKE_KEYS, publishedBy: "reviewer@example.com" }
    );
    expect(result.version).toBe(1);

    await t.run(async (ctx) => {
      const course = await ctx.db.get(courseId);
      expect(course?.status).toBe("published");
      expect(course?.specHash).toBe(FAKE_KEYS.specHash);
      const unit = await ctx.db.get(unitId);
      expect(unit?.state).toBe("published");
    });

    const snapshot = await t.query(
      internal.pipeline.publishedCourses.getPublishedCourseForRunInternal,
      { runId }
    );
    expect(snapshot).toMatchObject({
      version: 1,
      exportKey: FAKE_KEYS.exportKey,
      manifestKey: FAKE_KEYS.manifestKey,
      specHash: FAKE_KEYS.specHash,
      publishedBy: "reviewer@example.com",
      counts: FAKE_KEYS.counts,
    });
  });

  test("re-finalizing the same specHash is a no-op; a different one conflicts", async () => {
    const { t, runId } = await seedPublishable();
    const first = await t.mutation(
      internal.pipeline.publishedCourses.finalizePublish,
      { runId, ...FAKE_KEYS, publishedBy: "system" }
    );
    const second = await t.mutation(
      internal.pipeline.publishedCourses.finalizePublish,
      { runId, ...FAKE_KEYS, publishedBy: "system" }
    );
    expect(second.courseVersionId).toBe(first.courseVersionId);

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("courseVersions").take(10);
      expect(rows).toHaveLength(1);
    });

    await expect(
      t.mutation(internal.pipeline.publishedCourses.finalizePublish, {
        runId,
        ...FAKE_KEYS,
        specHash: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        publishedBy: "system",
      })
    ).rejects.toThrow(/PUBLISH_VERSION_CONFLICT/);
  });

  test("publishedBy comes from the PUBLISHING transition's actor", async () => {
    const { t, runId } = await seedPublishable();
    await t.run(async (ctx) => {
      await ctx.db.insert("runEvents", {
        runId,
        fromState: "GATE_3_PREVIEW",
        toState: "PUBLISHING",
        actor: "approver@example.com",
        detail: "gate 3 approved: publishing course",
      });
    });
    const input = await t.query(
      internal.pipeline.publishedCourses.getPublishInputInternal,
      { runId }
    );
    expect(input.publishedBy).toBe("approver@example.com");
  });
});

describe("published-course immutability", () => {
  async function seedPublished() {
    const seeded = await seedPublishable();
    await t_publish(seeded);
    return seeded;
  }
  async function t_publish(seeded: Awaited<ReturnType<typeof seedPublishable>>) {
    await seeded.t.mutation(
      internal.pipeline.publishedCourses.finalizePublish,
      { runId: seeded.runId, ...FAKE_KEYS, publishedBy: "system" }
    );
  }

  test("question edits refuse with COURSE_PUBLISHED", async () => {
    const { t, courseId } = await seedPublished();
    const questionId = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("questions")
        .withIndex("by_course", (q) => q.eq("courseId", courseId))
        .take(1);
      return rows[0]._id;
    });
    await expect(
      t.mutation(internal.pipeline.courses.replaceQuestionBody, {
        questionId,
        prompt: "Edited?",
        options: ["A", "B"],
        correctIndex: 0,
        explanation: "Edited.",
      })
    ).rejects.toThrow(/COURSE_PUBLISHED/);
  });

  test("narration edits refuse with COURSE_PUBLISHED even at a gate state", async () => {
    const { t, runId, unitId } = await seedPublished();
    // Run state is still GATE_3_PREVIEW here (finalize does not transition),
    // so this exercises the defense-in-depth course guard, not the state gate.
    await expect(
      t.mutation(internal.pipeline.tts.edit.updateNarrationSentence, {
        runId,
        unitId,
        narrationId: "n2",
        text: "Students arrive from 120 countries.",
      })
    ).rejects.toThrow(/COURSE_PUBLISHED/);
  });

  test("unit QA writes refuse with COURSE_PUBLISHED", async () => {
    const { t, unitId } = await seedPublished();
    await expect(
      t.mutation(internal.pipeline.courses.setUnitQa, {
        microUnitId: unitId,
        qa: { pass: true },
      })
    ).rejects.toThrow(/COURSE_PUBLISHED/);
  });

  test("recompiles into a published course refuse with COURSE_PUBLISHED", async () => {
    const { t, runId } = await seedPublished();
    const definitionWire = (
      await t.query(
        internal.pipeline.publishedCourses.getPublishInputInternal,
        { runId }
      )
    ).definitionWire;
    await expect(
      t.mutation(internal.pipeline.courses.saveCompiledCourse, {
        runId,
        definition: definitionWire,
      })
    ).rejects.toThrow(/COURSE_PUBLISHED/);
  });
});

describe("export round-trip", () => {
  test("published rows reconstruct into a valid CourseDefinition", async () => {
    const { t, runId } = await seedPublishable();
    await t.mutation(internal.pipeline.publishedCourses.finalizePublish, {
      runId,
      ...FAKE_KEYS,
      publishedBy: "system",
    });

    const input = await t.query(
      internal.pipeline.publishedCourses.getPublishInputInternal,
      { runId }
    );
    const wire = input.definitionWire as Record<string, unknown>;
    const { schemaRef, ...rest } = wire;
    const definition = parseCourseDefinition({ $schema: schemaRef, ...rest });
    expect(definition.courseId).toBe("latrobe-essentials");
    expect(definition.modules).toHaveLength(1);
    expect(definition.questionBank).toHaveLength(2);
  });
});
