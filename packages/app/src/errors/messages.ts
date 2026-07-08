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
  [AppErrorCode.UNITS_BLOCKED]:
    "Resolve every blocked or failed unit before approving this gate.",
  [AppErrorCode.TTS_NOT_CONFIGURED]:
    "Voice synthesis is not configured. Contact an administrator.",
  [AppErrorCode.NARRATION_NOT_FOUND]:
    "That narration sentence could not be found.",
  [AppErrorCode.NARRATION_EDIT_BREAKS_CARD]:
    "A card is anchored to a word this edit removes. Keep the anchor word or update the card first.",
  [AppErrorCode.RUN_NOT_EDITABLE]:
    "Narration can only be edited while the run is waiting at course review or preview.",
  [AppErrorCode.COURSE_PUBLISHED]:
    "This course is published and can no longer be edited. Re-run the pipeline to publish a new version.",
  [AppErrorCode.PUBLISH_VERSION_CONFLICT]:
    "A different snapshot of this course version was already published.",
  [AppErrorCode.ASSET_KEY_INVALID]:
    "That file's storage key is invalid. Re-select the file and try again.",
  [AppErrorCode.ASSET_JOB_NOT_FOUND]: "That upload job could not be found.",
  [AppErrorCode.ASSET_NOT_FOUND]: "That asset could not be found.",
  [AppErrorCode.ASSET_NOT_CLEARED]:
    "That asset's rights have not been cleared. Declare rights in the asset library first.",
  [AppErrorCode.ASSET_KIND_MISMATCH]:
    "That asset's type or shape does not fit this card template.",
  [AppErrorCode.CONVERTER_NOT_CONFIGURED]:
    "The media converter service is not reachable. Contact an administrator.",
  [AppErrorCode.OUTLINE_NOT_FOUND]: "This run has no course outline yet.",
  [AppErrorCode.OUTLINE_INVALID]:
    "The outline is invalid: every unit needs a real inventory concept, the unit count must stay within range, media suggestions must be cleared assets, and regenerate feedback cannot be empty.",
};
