import { createConvexClient } from "@counseliq/admin";

export const convex = createConvexClient(
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://localhost:3000"
);
