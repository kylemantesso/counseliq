import type { AppErrorContext } from "./app-error-context";

/** Platform-specific Sentry capture — no-op default for unsupported runtimes. */
export function captureAppError(
  _error: unknown,
  _context?: AppErrorContext
): void {}
