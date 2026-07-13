"use node";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { createObjectStoreClient } from "./pipeline/objectStore";

const PRESIGN_TTL_SECONDS = 10 * 60;

type RenderedUnitKey = {
  unitId: string;
  key: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  variants: Array<{
    label: string;
    key: string;
    durationMs: number;
    width: number;
    height: number;
    fps: number;
    sizeBytes: number;
  }>;
};

type UnitVideoUrlResult = {
  courseVersionId: string;
  expiresAt: number;
  units: Array<{
    unitId: string;
    url: string;
    durationMs: number;
    width: number;
    height: number;
    fps: number;
    variants: Array<{
      label: string;
      url: string;
      durationMs: number;
      width: number;
      height: number;
      fps: number;
      sizeBytes: number;
    }>;
  }>;
};

export const getUnitVideoUrls = action({
  args: {
    courseVersionId: v.id("courseVersions"),
    unitIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<UnitVideoUrlResult> => {
    const units: RenderedUnitKey[] = await ctx.runQuery(
      internal.publicCourses.getRenderedUnitKeysInternal,
      {
        courseVersionId: args.courseVersionId,
        unitIds: args.unitIds,
      }
    );
    const { client, bucket } = createObjectStoreClient();
    const expiresAt = Date.now() + PRESIGN_TTL_SECONDS * 1000;

    return {
      courseVersionId: args.courseVersionId,
      expiresAt,
      units: await Promise.all(
        units.map(async (unit) => {
          const url = await getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: bucket, Key: unit.key }),
            { expiresIn: PRESIGN_TTL_SECONDS }
          );
          return {
            unitId: unit.unitId,
            url,
            durationMs: unit.durationMs,
            width: unit.width,
            height: unit.height,
            fps: unit.fps,
            variants: await Promise.all(
              unit.variants.map(async (variant) => ({
                label: variant.label,
                url: await getSignedUrl(
                  client,
                  new GetObjectCommand({ Bucket: bucket, Key: variant.key }),
                  { expiresIn: PRESIGN_TTL_SECONDS }
                ),
                durationMs: variant.durationMs,
                width: variant.width,
                height: variant.height,
                fps: variant.fps,
                sizeBytes: variant.sizeBytes,
              }))
            ),
          };
        })
      ),
    };
  },
});
