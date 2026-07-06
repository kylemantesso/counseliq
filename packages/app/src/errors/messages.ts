import { AppErrorCode, type AppErrorCodeType } from "../../../../convex/errors";

/** User-facing copy for each backend error code. Edit here — not in Convex handlers. */
export const APP_ERROR_MESSAGES: Record<AppErrorCodeType, string> = {
  [AppErrorCode.UNAUTHORIZED]: "You need to sign in to continue.",
  [AppErrorCode.TASK_TITLE_REQUIRED]: "Enter a task title.",
  [AppErrorCode.TASK_NOT_FOUND]: "That task could not be found.",
  [AppErrorCode.PUSH_TOKEN_INVALID]: "Could not register for push notifications.",
  [AppErrorCode.EMAIL_SEND_FAILED]: "Could not send email. Try again later.",
  [AppErrorCode.ADMIN_FORBIDDEN]: "You do not have access to this page.",
  [AppErrorCode.USER_NOT_FOUND]: "User not found.",
};
