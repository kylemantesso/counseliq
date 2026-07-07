import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ConverterConfig } from "./config";

export class ObjectStore {
  private client: S3Client;
  private bucket: string;

  constructor(store: ConverterConfig["store"]) {
    this.bucket = store.bucket;
    this.client = new S3Client({
      endpoint: store.endpoint,
      region: store.region,
      credentials: {
        accessKeyId: store.accessKeyId,
        secretAccessKey: store.secretAccessKey,
      },
      // Path-style addressing works with MinIO, Tigris, and AWS.
      forcePathStyle: true,
    });
  }

  async download(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    if (!result.Body) {
      throw new Error(`Object ${key} has no body`);
    }
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return true;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey" || name === "404") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Content-addressed keys never change contents, so if the key already
   * exists the upload is skipped (idempotent re-conversion).
   */
  async uploadIfAbsent(
    key: string,
    bytes: Uint8Array,
    contentType: string
  ): Promise<void> {
    if (await this.exists(key)) return;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      })
    );
  }
}

export function contentTypeForExt(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext.replace(/^\./, "").toLowerCase()] ?? "application/octet-stream";
}
