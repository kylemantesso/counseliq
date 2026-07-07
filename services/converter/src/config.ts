export interface ConverterConfig {
  port: number;
  callbackSecret: string;
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

export function loadConfig(): ConverterConfig {
  return {
    port: Number(process.env.PORT ?? 8080),
    callbackSecret: required("CONVERTER_CALLBACK_SECRET"),
    store: {
      endpoint: required("OBJECT_STORE_ENDPOINT"),
      region: process.env.OBJECT_STORE_REGION ?? "auto",
      bucket: required("OBJECT_STORE_BUCKET"),
      accessKeyId: required("OBJECT_STORE_ACCESS_KEY_ID"),
      secretAccessKey: required("OBJECT_STORE_SECRET_ACCESS_KEY"),
    },
  };
}
