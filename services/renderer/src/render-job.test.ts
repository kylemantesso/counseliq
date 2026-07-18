import assert from "node:assert/strict";
import test from "node:test";
import { renderJobRequestSchema } from "@counseliq/course-schema";
import { readAvatarTrackFromFrozenManifest } from "./render-job";

const AVATAR_KEY = `sha256/${"a".repeat(64)}.mp4`;

test("reads a valid avatar track from frozen unit metadata", () => {
  const thumbKey = `sha256/${"b".repeat(64)}.jpg`;
  assert.deepEqual(
    readAvatarTrackFromFrozenManifest(
      {
        units: [
          { unitId: "other-unit" },
          {
            unitId: "target-unit",
            avatarTrack: {
              objectKey: AVATAR_KEY,
              thumbKey,
              durationMs: 12_345,
            },
          },
        ],
      },
      "target-unit"
    ),
    { objectKey: AVATAR_KEY, thumbKey, durationMs: 12_345 }
  );
});

test("rejects malformed frozen avatar metadata", () => {
  assert.throws(
    () =>
      readAvatarTrackFromFrozenManifest(
        { units: [{ unitId: "target-unit", avatarTrack: { objectKey: "bad" } }] },
        "target-unit"
      ),
    /invalid units\[\]\.avatarTrack/
  );
});

test("keeps avatarTrack optional on render jobs", () => {
  const request = {
    jobId: "job-1",
    runId: "run-1",
    courseVersionId: "course-version-1",
    manifestKey: `sha256/${"b".repeat(64)}.json`,
    exportKey: `sha256/${"c".repeat(64)}.json`,
    specHash: "spec-hash",
    unitId: "unit-1",
    moduleId: "module-1",
    unitIndex: 0,
    contentHash: "content-hash",
    renderSpecHash: "render-spec-hash",
    profile: {
      container: "mp4" as const,
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: "h264",
      audioCodec: "aac",
    },
    callbackUrl: "https://example.test/render-callback",
  };

  assert.equal(renderJobRequestSchema.safeParse(request).success, true);
  assert.equal(
    renderJobRequestSchema.safeParse({
      ...request,
      avatarTrack: { objectKey: AVATAR_KEY },
    }).success,
    true
  );
});
