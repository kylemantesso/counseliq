/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("avatar generation progress", () => {
  test("queues HeyGen directly from continuous unit audio", async () => {
    const t = convexTest(schema, modules);
    const { runId, audioKey } = await t.run(async (ctx) => {
      const institutionId = await ctx.db.insert("institutions", {
        name: "Continuous Audio University",
        brandTokens: {},
        pronunciationLexicon: {},
        market: "AU",
      });
      const courseId = await ctx.db.insert("courses", {
        institutionId,
        title: "Continuous avatar course",
        level: 3,
        version: 1,
        status: "in_review",
        definitionMeta: {
          presentation: {
            mode: "avatar",
            provider: "heygen",
            avatarGroupId: "group-1",
            defaultLook: {
              groupId: "group-1",
              lookId: "look-1",
              name: "Presenter",
            },
            unitLooks: {},
            assignmentStrategy: "ai-per-unit",
            engine: "avatar_v",
          },
        },
      });
      const runId = await ctx.db.insert("runs", {
        institutionId,
        courseId,
        state: "GENERATING_ASSETS",
        promptVersions: {},
      });
      const audioKey = `sha256/${"c".repeat(64)}.mp3`;
      await ctx.db.insert("microUnits", {
        courseId,
        moduleKey: "m1",
        moduleTitle: "Welcome",
        unitKey: "mu-101",
        concept: "Welcome",
        narration: [],
        cards: [],
        meta: { order: { module: 0, unit: 0 } },
        state: "assets_ready",
        audioKey,
      });
      await ctx.db.insert("avatarLooks", {
        provider: "heygen",
        groupId: "group-1",
        lookId: "look-1",
        name: "Presenter",
        previewImageUrl: null,
        preferredOrientation: "portrait",
        supportedEngines: ["avatar_v"],
        avatarType: "digital_twin",
        status: "completed",
        tags: [],
        sourceHash: "look-hash",
        syncedAt: 1,
      });
      return { runId, audioKey };
    });

    const narration = await t.mutation(
      internal.pipeline.avatar.jobs.prepareAvatarGeneration,
      { runId }
    );
    expect(narration).toEqual({ enabled: true, queued: 1 });
    await t.mutation(internal.pipeline.avatar.jobs.createQueuedAvatarJobs, { runId });

    await t.run(async (ctx) => {
      const jobs = await ctx.db.query("avatarJobs").take(10);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].audioKey).toBe(audioKey);
    });
  });

  test("dispatches an explicitly queued video after the automatic attempt limit", async () => {
    const t = convexTest(schema, modules);
    const { runId, jobId } = await t.run(async (ctx) => {
      const institutionId = await ctx.db.insert("institutions", {
        name: "Avatar Retry University",
        brandTokens: {},
        pronunciationLexicon: {},
        market: "AU",
      });
      const courseId = await ctx.db.insert("courses", {
        institutionId,
        title: "Avatar retry course",
        level: 3,
        version: 1,
        status: "in_review",
        definitionMeta: {},
      });
      const runId = await ctx.db.insert("runs", {
        institutionId,
        courseId,
        state: "GATE_3_PREVIEW",
        promptVersions: {},
      });
      const unitId = await ctx.db.insert("microUnits", {
        courseId,
        moduleKey: "m1",
        moduleTitle: "Welcome",
        unitKey: "mu-101",
        concept: "Welcome",
        narration: [],
        cards: [],
        meta: { order: { module: 0, unit: 0 } },
        state: "assets_ready",
      });
      const jobId = await ctx.db.insert("avatarJobs", {
        runId,
        courseId,
        unitId,
        moduleId: "m1",
        unitIndex: 0,
        look: {
          groupId: "group-1",
          lookId: "look-1",
          name: "Campus presenter",
        },
        engine: "avatar_v",
        inputHash: "avatar-input-hash",
        audioKey: "sha256/unit.mp3",
        status: "queued",
        attempts: 3,
        maxAttempts: 3,
        createdAt: 100,
        updatedAt: 200,
      });
      return { runId, jobId };
    });

    const queued = await t.query(
      internal.pipeline.avatar.jobs.listQueuedAvatarJobs,
      { runId }
    );

    expect(queued.map((job) => job._id)).toEqual([jobId]);
  });
});
