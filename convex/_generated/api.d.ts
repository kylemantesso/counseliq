/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as adminAccess from "../adminAccess.js";
import type * as adminEmailActions from "../adminEmailActions.js";
import type * as adminEmails from "../adminEmails.js";
import type * as adminNotifications from "../adminNotifications.js";
import type * as adminOutbox from "../adminOutbox.js";
import type * as appConfig from "../appConfig.js";
import type * as auth from "../auth.js";
import type * as authIdentity from "../authIdentity.js";
import type * as crons from "../crons.js";
import type * as emailPreviewHtml from "../emailPreviewHtml.js";
import type * as emailQueries from "../emailQueries.js";
import type * as emailResend from "../emailResend.js";
import type * as emailSend from "../emailSend.js";
import type * as emailTemplateMeta from "../emailTemplateMeta.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as emails_EmailLayout from "../emails/EmailLayout.js";
import type * as emails_WelcomeEmail from "../emails/WelcomeEmail.js";
import type * as errors from "../errors.js";
import type * as http from "../http.js";
import type * as notificationConstants from "../notificationConstants.js";
import type * as notificationDeliver from "../notificationDeliver.js";
import type * as notificationOutbox from "../notificationOutbox.js";
import type * as notificationPreferences from "../notificationPreferences.js";
import type * as notificationQueries from "../notificationQueries.js";
import type * as pipeline_compiler_assemble from "../pipeline/compiler/assemble.js";
import type * as pipeline_compiler_compile from "../pipeline/compiler/compile.js";
import type * as pipeline_compiler_judge from "../pipeline/compiler/judge.js";
import type * as pipeline_compiler_judgeCore from "../pipeline/compiler/judgeCore.js";
import type * as pipeline_compiler_judgeEval from "../pipeline/compiler/judgeEval.js";
import type * as pipeline_compiler_rules from "../pipeline/compiler/rules.js";
import type * as pipeline_compiler_schemas from "../pipeline/compiler/schemas.js";
import type * as pipeline_courses from "../pipeline/courses.js";
import type * as pipeline_extract from "../pipeline/extract.js";
import type * as pipeline_extraction_assemble from "../pipeline/extraction/assemble.js";
import type * as pipeline_hmac from "../pipeline/hmac.js";
import type * as pipeline_ingestion from "../pipeline/ingestion.js";
import type * as pipeline_inventory from "../pipeline/inventory.js";
import type * as pipeline_llm_client from "../pipeline/llm/client.js";
import type * as pipeline_llm_models from "../pipeline/llm/models.js";
import type * as pipeline_llm_pricing from "../pipeline/llm/pricing.js";
import type * as pipeline_llm_schemas from "../pipeline/llm/schemas.js";
import type * as pipeline_llmCalls from "../pipeline/llmCalls.js";
import type * as pipeline_objectStore from "../pipeline/objectStore.js";
import type * as pipeline_prompts_index from "../pipeline/prompts/index.js";
import type * as pipeline_queries from "../pipeline/queries.js";
import type * as pipeline_reviewItems from "../pipeline/reviewItems.js";
import type * as pipeline_runs from "../pipeline/runs.js";
import type * as pipeline_seed from "../pipeline/seed.js";
import type * as pipeline_states from "../pipeline/states.js";
import type * as pipeline_steps from "../pipeline/steps.js";
import type * as pipeline_transitions from "../pipeline/transitions.js";
import type * as pipeline_tts_lexicon from "../pipeline/tts/lexicon.js";
import type * as pipeline_tts_normalize from "../pipeline/tts/normalize.js";
import type * as pipeline_tts_script from "../pipeline/tts/script.js";
import type * as pipeline_workflows from "../pipeline/workflows.js";
import type * as pushNotificationSend from "../pushNotificationSend.js";
import type * as pushNotifications from "../pushNotifications.js";
import type * as tasks from "../tasks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminAccess: typeof adminAccess;
  adminEmailActions: typeof adminEmailActions;
  adminEmails: typeof adminEmails;
  adminNotifications: typeof adminNotifications;
  adminOutbox: typeof adminOutbox;
  appConfig: typeof appConfig;
  auth: typeof auth;
  authIdentity: typeof authIdentity;
  crons: typeof crons;
  emailPreviewHtml: typeof emailPreviewHtml;
  emailQueries: typeof emailQueries;
  emailResend: typeof emailResend;
  emailSend: typeof emailSend;
  emailTemplateMeta: typeof emailTemplateMeta;
  emailTemplates: typeof emailTemplates;
  "emails/EmailLayout": typeof emails_EmailLayout;
  "emails/WelcomeEmail": typeof emails_WelcomeEmail;
  errors: typeof errors;
  http: typeof http;
  notificationConstants: typeof notificationConstants;
  notificationDeliver: typeof notificationDeliver;
  notificationOutbox: typeof notificationOutbox;
  notificationPreferences: typeof notificationPreferences;
  notificationQueries: typeof notificationQueries;
  "pipeline/compiler/assemble": typeof pipeline_compiler_assemble;
  "pipeline/compiler/compile": typeof pipeline_compiler_compile;
  "pipeline/compiler/judge": typeof pipeline_compiler_judge;
  "pipeline/compiler/judgeCore": typeof pipeline_compiler_judgeCore;
  "pipeline/compiler/judgeEval": typeof pipeline_compiler_judgeEval;
  "pipeline/compiler/rules": typeof pipeline_compiler_rules;
  "pipeline/compiler/schemas": typeof pipeline_compiler_schemas;
  "pipeline/courses": typeof pipeline_courses;
  "pipeline/extract": typeof pipeline_extract;
  "pipeline/extraction/assemble": typeof pipeline_extraction_assemble;
  "pipeline/hmac": typeof pipeline_hmac;
  "pipeline/ingestion": typeof pipeline_ingestion;
  "pipeline/inventory": typeof pipeline_inventory;
  "pipeline/llm/client": typeof pipeline_llm_client;
  "pipeline/llm/models": typeof pipeline_llm_models;
  "pipeline/llm/pricing": typeof pipeline_llm_pricing;
  "pipeline/llm/schemas": typeof pipeline_llm_schemas;
  "pipeline/llmCalls": typeof pipeline_llmCalls;
  "pipeline/objectStore": typeof pipeline_objectStore;
  "pipeline/prompts/index": typeof pipeline_prompts_index;
  "pipeline/queries": typeof pipeline_queries;
  "pipeline/reviewItems": typeof pipeline_reviewItems;
  "pipeline/runs": typeof pipeline_runs;
  "pipeline/seed": typeof pipeline_seed;
  "pipeline/states": typeof pipeline_states;
  "pipeline/steps": typeof pipeline_steps;
  "pipeline/transitions": typeof pipeline_transitions;
  "pipeline/tts/lexicon": typeof pipeline_tts_lexicon;
  "pipeline/tts/normalize": typeof pipeline_tts_normalize;
  "pipeline/tts/script": typeof pipeline_tts_script;
  "pipeline/workflows": typeof pipeline_workflows;
  pushNotificationSend: typeof pushNotificationSend;
  pushNotifications: typeof pushNotifications;
  tasks: typeof tasks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  notificationPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"notificationPool">;
  extractionPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"extractionPool">;
  compilePool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"compilePool">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
