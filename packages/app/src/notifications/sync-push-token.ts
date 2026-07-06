export type SyncPushTokenResult =
  | { synced: true; token: string; platform: "ios" | "android" }
  | { synced: false; reason: "unsupported" | "simulator" | "permission" | "no_project_id" };

export async function syncPushTokenIfGranted(): Promise<SyncPushTokenResult> {
  return { synced: false, reason: "unsupported" };
}
