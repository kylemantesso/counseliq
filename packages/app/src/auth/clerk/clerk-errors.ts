export function clerkErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    if (
      "longMessage" in err &&
      typeof (err as { longMessage?: string }).longMessage === "string"
    ) {
      return (err as { longMessage: string }).longMessage;
    }
    if ("errors" in err) {
      const errors = (err as { errors: Array<{ message?: string }> }).errors;
      const first = errors[0]?.message;
      if (first) return first;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
