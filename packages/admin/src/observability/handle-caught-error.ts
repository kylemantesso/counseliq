import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";
import type { AppErrorContext } from "./app-error-context";
import { reportAppError } from "./report-app-error";

/** Report unexpected errors, then resolve user-facing copy. */
export function handleCaughtError(
  error: unknown,
  options: {
    fallback: string;
    context?: AppErrorContext;
    report?: boolean;
  }
): string {
  if (options.report !== false) {
    reportAppError(error, options.context);
  }
  return getUserFacingErrorMessage(error, options.fallback);
}
