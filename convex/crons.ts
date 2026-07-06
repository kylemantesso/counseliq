import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "notification outbox cleanup",
  { hours: 24 },
  internal.notificationOutbox.cleanupOldDeliveries,
  {}
);

export default crons;
