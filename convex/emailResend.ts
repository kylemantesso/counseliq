import { components } from "./_generated/api";
import { Resend } from "@convex-dev/resend";

export const resend = new Resend(components.resend, {
  testMode: process.env.RESEND_TEST_MODE === "true",
});

export function emailFromAddress(): string {
  return process.env.RESEND_FROM ?? "App Template <notifications@example.com>";
}

export function appWebOrigin(): string {
  return (process.env.APP_WEB_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
}
