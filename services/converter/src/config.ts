export interface MediaCaps {
  /** Videos longer than this are rejected (transcode cost + attention span). */
  maxVideoSeconds: number;
  /** Any single input file larger than this is rejected. */
  maxFileMb: number;
  /** Transcoded video is scaled down so its longest edge fits this. */
  maxVideoEdgePx: number;
  /** Images are re-encoded smaller when their longest edge exceeds this. */
  maxImageEdgePx: number;
  /** Image thumbnail longest edge. */
  thumbEdgePx: number;
  /** Video poster-frame longest edge (doubles as the grid thumbnail). */
  posterEdgePx: number;
}

export interface ConverterConfig {
  port: number;
  callbackSecret: string;
  media: MediaCaps;
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

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number`);
  }
  return value;
}

export function loadMediaCaps(): MediaCaps {
  return {
    maxVideoSeconds: numberEnv("MAX_VIDEO_SECONDS", 60),
    maxFileMb: numberEnv("MAX_FILE_MB", 500),
    maxVideoEdgePx: numberEnv("MAX_VIDEO_EDGE_PX", 1920),
    maxImageEdgePx: numberEnv("MAX_IMAGE_EDGE_PX", 2560),
    thumbEdgePx: numberEnv("THUMB_EDGE_PX", 480),
    posterEdgePx: numberEnv("POSTER_EDGE_PX", 960),
  };
}

export function loadConfig(): ConverterConfig {
  return {
    port: Number(process.env.PORT ?? 8080),
    callbackSecret: required("CONVERTER_CALLBACK_SECRET"),
    media: loadMediaCaps(),
    store: {
      endpoint: required("OBJECT_STORE_ENDPOINT"),
      region: process.env.OBJECT_STORE_REGION ?? "auto",
      bucket: required("OBJECT_STORE_BUCKET"),
      accessKeyId: required("OBJECT_STORE_ACCESS_KEY_ID"),
      secretAccessKey: required("OBJECT_STORE_SECRET_ACCESS_KEY"),
    },
  };
}
