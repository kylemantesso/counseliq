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
  [AppErrorCode.INSTITUTION_NOT_FOUND]: "That institution could not be found.",
  [AppErrorCode.RUN_NOT_FOUND]: "That pipeline run could not be found.",
  [AppErrorCode.RUN_TRANSITION_INVALID]:
    "That pipeline run cannot move to the requested state.",
  [AppErrorCode.RUN_NOT_AT_GATE]:
    "That pipeline run is not waiting at the requested review gate.",
  [AppErrorCode.SOURCE_DOC_NOT_FOUND]: "That source document could not be found.",
  [AppErrorCode.OBJECT_STORE_NOT_CONFIGURED]:
    "File storage is not configured. Contact an administrator.",
  [AppErrorCode.GATE_ITEMS_UNRESOLVED]:
    "Resolve every flagged fact (approve with a source, or exclude) before approving this gate.",
  [AppErrorCode.REVIEW_ITEM_NOT_FOUND]: "That review item could not be found.",
  [AppErrorCode.REVIEW_ITEM_ALREADY_RESOLVED]:
    "That review item has already been resolved.",
  [AppErrorCode.REVIEW_ITEM_SOURCE_REQUIRED]:
    "Enter a source label and year to approve this fact.",
  [AppErrorCode.COURSE_NOT_FOUND]: "That course could not be found.",
  [AppErrorCode.QUESTION_NOT_FOUND]: "That question could not be found.",
  [AppErrorCode.QUESTION_INVALID]:
    "Fill in the prompt, at least two options, a correct answer, and an explanation.",
  [AppErrorCode.UNITS_REQUIRED]:
    "Select at least one unit of this run's course to send back.",
};
