import { createConvexClient } from "@counseliq/client";

export const convex = createConvexClient(
  process.env.EXPO_PUBLIC_CONVEX_URL ?? "http://localhost:3000"
);
