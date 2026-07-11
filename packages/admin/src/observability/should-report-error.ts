import { parseAppErrorCode } from "../errors/get-user-facing-message";

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  return error.message.toLowerCase().includes("abort");
}

function isClerkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  if (
    "errors" in error &&
    Array.isArray((error as { errors: unknown }).errors)
  ) {
    return true;
  }

  if (
    "longMessage" in error &&
    typeof (error as { longMessage?: unknown }).longMessage === "string"
  ) {
    return true;
  }

  if ("clerkError" in error || "clerkTraceId" in error) {
    return true;
  }

  return false;
}

/** Whether an error should be reported to Sentry (unexpected / non-user-input). */
export function shouldReportError(error: unknown): boolean {
  if (error == null) return false;
  if (parseAppErrorCode(error)) return false;
  if (isAbortError(error)) return false;
  if (isClerkError(error)) return false;
  return true;
}
