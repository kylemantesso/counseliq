import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { RendererConfig } from "./config";

export class ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(store: RendererConfig["store"]) {
    this.bucket = store.bucket;
    this.client = new S3Client({
      endpoint: store.endpoint,
      region: store.region,
      credentials: {
        accessKeyId: store.accessKeyId,
        secretAccessKey: store.secretAccessKey,
      },
      forcePathStyle: true,
    });
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

  async downloadBytes(key: string): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    if (!result.Body) {
      throw new Error(`Object ${key} has no body`);
    }
    return await result.Body.transformToByteArray();
  }

  async downloadText(key: string): Promise<string> {
    const bytes = await this.downloadBytes(key);
    return Buffer.from(bytes).toString("utf8");
  }

  async presignGet(key: string, expiresInSeconds: number): Promise<string> {
    return await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds }
    );
  }
}
