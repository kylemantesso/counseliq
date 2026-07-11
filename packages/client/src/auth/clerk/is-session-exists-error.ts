export function isSessionExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  if ("errors" in err) {
    const errors = (err as { errors: Array<{ code?: string; message?: string }> })
      .errors;
    const first = errors[0];
    if (first?.code === "session_exists") return true;
    if (first?.message?.toLowerCase().includes("session already exists")) {
      return true;
    }
  }

  if ("longMessage" in err) {
    const longMessage = (err as { longMessage?: string }).longMessage;
    if (longMessage?.toLowerCase().includes("session already exists")) {
      return true;
    }
  }

  if (err instanceof Error) {
    return err.message.toLowerCase().includes("session already exists");
  }

  return false;
}
