import type { AppErrorCodeType } from "../../../../convex/errors";
import { APP_ERROR_MESSAGES } from "./messages";

/** Pattern for expected auth failures logged by the Convex client. */
export const EXPECTED_AUTH_CONVEX_LOG = /\[CONVEX [MA]\(auth:/;

export function parseAppErrorCode(error: unknown): AppErrorCodeType | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;

  const data = (error as { data: unknown }).data;
  if (!data || typeof data !== "object" || !("code" in data)) return null;

  const code = (data as { code: unknown }).code;
  if (typeof code === "string" && code in APP_ERROR_MESSAGES) {
    return code as AppErrorCodeType;
  }

  return null;
}

/**
 * Resolve a caught error to UI copy via backend error codes.
 * Never reads error.message — unknown errors use the fallback.
 */
export function getUserFacingErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  const code = parseAppErrorCode(error);
  if (code) return APP_ERROR_MESSAGES[code];
  return fallback;
}
