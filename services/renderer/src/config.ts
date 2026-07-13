export interface RendererConfig {
  port: number;
  callbackSecret: string;
  rendererVersion: string;
  signedUrlTtlSeconds: number;
  store: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return value;
}

export function loadConfig(): RendererConfig {
  return {
    port: Number(process.env.PORT ?? 8081),
    callbackSecret: required("RENDERER_CALLBACK_SECRET"),
    rendererVersion: process.env.RENDERER_VERSION?.trim() || "renderer@4-responsive",
    signedUrlTtlSeconds: positiveIntEnv("RENDERER_SIGNED_URL_TTL_SECONDS", 3600),
    store: {
      endpoint: required("OBJECT_STORE_ENDPOINT"),
      region: process.env.OBJECT_STORE_REGION ?? "auto",
      bucket: required("OBJECT_STORE_BUCKET"),
      accessKeyId: required("OBJECT_STORE_ACCESS_KEY_ID"),
      secretAccessKey: required("OBJECT_STORE_SECRET_ACCESS_KEY"),
    },
  };
}
