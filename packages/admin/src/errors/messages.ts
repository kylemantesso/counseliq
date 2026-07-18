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
  [AppErrorCode.INSTITUTION_NAME_REQUIRED]: "Enter an institution name.",
  [AppErrorCode.INSTITUTION_ALREADY_EXISTS]: "An institution with that name already exists.",
  [AppErrorCode.INSTITUTION_WEBSITE_URL_INVALID]:
    "Enter a valid institution website URL (for example, https://example.edu).",
  [AppErrorCode.INSTITUTION_WEBSITE_URL_REQUIRED]:
    "Enter the institution website URL before extracting a theme.",
  [AppErrorCode.INSTITUTION_THEME_EXTRACTION_FAILED]:
    "Could not extract a theme from that website. Check the URL and try again.",
  [AppErrorCode.INSTITUTION_LOGO_URL_INVALID]:
    "Enter a valid logo image URL, or upload a logo file.",
  [AppErrorCode.INSTITUTION_LOGO_FETCH_FAILED]:
    "Could not copy that logo image. Check the URL or upload the logo file.",
  [AppErrorCode.INSTITUTION_LOGO_FILE_INVALID]:
    "Logo must be an image file under 2 MB.",
  [AppErrorCode.INSTITUTION_LOGO_NOT_FOUND]:
    "That uploaded logo could not be found. Upload it again.",
  [AppErrorCode.RUN_NOT_FOUND]: "That pipeline run could not be found.",
  [AppErrorCode.RUN_TRANSITION_INVALID]:
    "That pipeline run cannot move to the requested state.",
  [AppErrorCode.RUN_NOT_AT_GATE]:
    "That pipeline run is not waiting at the requested review step.",
  [AppErrorCode.RUN_ASSET_SELECTION_INVALID]:
    "The selected media must be unique catalogue assets from this run's institution.",
  [AppErrorCode.RUN_SELECTED_ASSETS_NOT_CLEARED]:
    "Clear the rights and any required people consent for every selected media asset before publishing.",
  [AppErrorCode.SOURCE_DOC_NOT_FOUND]: "That source document could not be found.",
  [AppErrorCode.SOURCE_DOCS_REQUIRED]:
    "Select at least one uploaded source document before generating a course.",
  [AppErrorCode.SOURCE_DOC_FACTS_PENDING_REVIEW]:
    "Review and approve extracted facts for each selected source document before generating a course.",
  [AppErrorCode.OBJECT_STORE_NOT_CONFIGURED]:
    "File storage is not configured. Contact an administrator.",
  [AppErrorCode.COURSE_NOT_FOUND]: "That course could not be found.",
  [AppErrorCode.COURSE_TITLE_REQUIRED]: "Enter a course title.",
  [AppErrorCode.MODULE_NOT_FOUND]: "That module could not be found in this course.",
  [AppErrorCode.MODULE_TITLE_REQUIRED]: "Enter a module title.",
  [AppErrorCode.QUESTION_NOT_FOUND]: "That question could not be found.",
  [AppErrorCode.QUESTION_INVALID]:
    "Fill in the prompt, at least two options, a correct answer, and an explanation.",
  [AppErrorCode.UNITS_REQUIRED]:
    "Select at least one unit of this run's course to send back.",
  [AppErrorCode.UNITS_BLOCKED]:
    "Resolve every blocked or failed unit before approving this step.",
  [AppErrorCode.TTS_NOT_CONFIGURED]:
    "Voice synthesis is not configured. Contact an administrator.",
  [AppErrorCode.TTS_VOICE_INVALID]:
    "Choose a valid ElevenLabs voice before auditioning or setting narration.",
  [AppErrorCode.TTS_AUDITION_FAILED]:
    "Could not audition that voice. Try another voice or try again later.",
  [AppErrorCode.NARRATION_NOT_FOUND]:
    "That narration sentence could not be found.",
  [AppErrorCode.NARRATION_EDIT_BREAKS_CARD]:
    "A card is anchored to a word this edit removes. Keep the anchor word or update the card first.",
  [AppErrorCode.CARD_NOT_FOUND]:
    "That card could not be found for this unit.",
  [AppErrorCode.CARD_PROPS_INVALID]:
    "Check the card fields. Required text fields cannot be empty.",
  [AppErrorCode.CARD_ENTER_AT_WORD_INVALID]:
    "Enter-at word must appear in the card's linked narration sentence.",
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
  [AppErrorCode.MODEL_ROUTING_INVALID]:
    "Select a supported OpenRouter model for every pipeline task.",
  [AppErrorCode.RENDERER_NOT_CONFIGURED]:
    "The renderer service is not configured. Contact an administrator.",
  [AppErrorCode.RENDER_JOB_NOT_FOUND]: "That render job could not be found.",
  [AppErrorCode.RENDER_JOB_NOT_RETRYABLE]:
    "That render job cannot be retried in its current state.",
  [AppErrorCode.AVATAR_NOT_CONFIGURED]:
    "HeyGen avatar generation is not configured. Contact an administrator.",
  [AppErrorCode.AVATAR_LOOK_INVALID]:
    "Choose a completed HeyGen avatar look before generating the course.",
  [AppErrorCode.AVATAR_GENERATION_FAILED]:
    "Avatar video generation failed. Retry the affected unit from preview.",
};
