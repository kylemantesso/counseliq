"use node";

import { v } from "convex/values";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { AppErrorCode, appError } from "../errors";

const PRESIGN_TTL_SECONDS = 10 * 60;

export interface ObjectStoreClient {
  client: S3Client;
  bucket: string;
}

/** Plain client factory for other "use node" pipeline files (publish). */
export function createObjectStoreClient(): ObjectStoreClient {
  return createClient();
}

/** True when the object exists (HeadObject succeeds). */
export async function headObjectExists(
  store: ObjectStoreClient,
  key: string
): Promise<boolean> {
  try {
    await store.client.send(
      new HeadObjectCommand({ Bucket: store.bucket, Key: key })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Content-addressed write: keys embed the content hash, so an existing
 * object is by definition identical — skip the PUT.
 */
export async function putObjectIfAbsent(
  store: ObjectStoreClient,
  key: string,
  body: string | Uint8Array,
  contentType: string
): Promise<void> {
  if (await headObjectExists(store, key)) return;
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

/** Fetch an object's body as UTF-8 text (publish verification). */
export async function getObjectText(
  store: ObjectStoreClient,
  key: string
): Promise<string> {
  const result = await store.client.send(
    new GetObjectCommand({ Bucket: store.bucket, Key: key })
  );
  if (!result.Body) {
    throw new Error(`object ${key} has no body`);
  }
  return await result.Body.transformToString("utf-8");
}

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
 * Admin-only batch presign for browser uploads (asset library). Keys must
 * be content-addressed — the browser hashes each file with crypto.subtle
 * before asking, so re-uploads of identical bytes reuse the same object.
 * URLs are short-lived and never logged.
 */
export const adminPresignPutBatch = action({
  args: {
    items: v.array(v.object({ key: v.string(), contentType: v.string() })),
  },
  handler: async (ctx, args): Promise<{ key: string; url: string }[]> => {
    await ctx.runQuery(internal.pipeline.queries.assertAdmin, {});
    const { client, bucket } = createClient();
    const items = args.items.slice(0, 100);
    for (const item of items) {
      if (!/^sha256\/[0-9a-f]{64}\.[a-z0-9]+$/.test(item.key)) {
        appError(AppErrorCode.ASSET_KEY_INVALID);
      }
    }
    return await Promise.all(
      items.map(async (item) => ({
        key: item.key,
        url: await getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: bucket,
            Key: item.key,
            ContentType: item.contentType,
          }),
          { expiresIn: PRESIGN_TTL_SECONDS }
        ),
      }))
    );
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

/**
 * Admin-only download URLs. The signed response explicitly requests an
 * attachment so browsers download cross-origin object-store files reliably.
 */
export const adminPresignDownloadBatch = action({
  args: {
    items: v.array(v.object({ key: v.string(), filename: v.string() })),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ key: string; url: string; filename: string }[]> => {
    await ctx.runQuery(internal.pipeline.queries.assertAdmin, {});
    const { client, bucket } = createClient();
    const items = args.items.slice(0, 300);
    return await Promise.all(
      items.map(async ({ key, filename }) => {
        // Keep a user-supplied label from becoming an invalid response header.
        const safeFilename = filename
          .replace(/[^\x20-\x7e]|[\\/";]/g, "-")
          .trim()
          .slice(0, 180) || "download";
        return {
          key,
          filename: safeFilename,
          url: await getSignedUrl(
            client,
            new GetObjectCommand({
              Bucket: bucket,
              Key: key,
              ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
            }),
            { expiresIn: PRESIGN_TTL_SECONDS }
          ),
        };
      })
    );
  },
});
