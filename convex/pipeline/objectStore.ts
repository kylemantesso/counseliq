"use node";

import { v } from "convex/values";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { AppErrorCode, appError } from "../errors";

const PRESIGN_TTL_SECONDS = 10 * 60;

function createClient(): { client: S3Client; bucket: string } {
  const endpoint = process.env.OBJECT_STORE_ENDPOINT;
  const bucket = process.env.OBJECT_STORE_BUCKET;
  const accessKeyId = process.env.OBJECT_STORE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OBJECT_STORE_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    appError(AppErrorCode.OBJECT_STORE_NOT_CONFIGURED);
  }
  const client = new S3Client({
    endpoint,
    region: process.env.OBJECT_STORE_REGION ?? "auto",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return { client, bucket };
}

/** Short-lived presigned PUT URL for uploading a content-addressed object. */
export const presignPut = internalAction({
  args: { key: v.string(), contentType: v.string() },
  handler: async (_ctx, args) => {
    const { client, bucket } = createClient();
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: args.key,
        ContentType: args.contentType,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS }
    );
    return { url };
  },
});

/** Short-lived presigned GET URL for reading an object. */
export const presignGet = internalAction({
  args: { key: v.string() },
  handler: async (_ctx, args) => {
    const { client, bucket } = createClient();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: args.key }),
      { expiresIn: PRESIGN_TTL_SECONDS }
    );
    return { url };
  },
});

/**
 * Admin-only batch presign for the ingestion inspector page (page PNGs,
 * thumbnails, logo candidates). URLs are short-lived and never logged.
 */
export const adminPresignGetBatch = action({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ key: string; url: string }[]> => {
    await ctx.runQuery(internal.pipeline.queries.assertAdmin, {});
    const { client, bucket } = createClient();
    const keys = args.keys.slice(0, 300);
    return await Promise.all(
      keys.map(async (key) => ({
        key,
        url: await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          { expiresIn: PRESIGN_TTL_SECONDS }
        ),
      }))
    );
  },
});
