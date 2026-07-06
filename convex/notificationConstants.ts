export const PROCESSING_STALE_MS = 15 * 60 * 1000;

export const MAX_DELIVERY_ATTEMPTS = 5;

export const OUTBOX_BATCH_SIZE = 50;

export const OUTBOX_RETENTION_SENT_SKIPPED_MS = 90 * 24 * 60 * 60 * 1000;

export const OUTBOX_RETENTION_FAILED_MS = 180 * 24 * 60 * 60 * 1000;

export const OUTBOX_CLEANUP_BATCH_SIZE = 100;

export type NotificationType = "admin_test" | "welcome";

export type NotificationChannel = "email" | "push";

export type NotificationDeliveryStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "skipped";
