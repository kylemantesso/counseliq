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
import type * as pipeline_hmac from "../pipeline/hmac.js";
import type * as pipeline_ingestion from "../pipeline/ingestion.js";
import type * as pipeline_objectStore from "../pipeline/objectStore.js";
import type * as pipeline_queries from "../pipeline/queries.js";
import type * as pipeline_reviewItems from "../pipeline/reviewItems.js";
import type * as pipeline_runs from "../pipeline/runs.js";
import type * as pipeline_seed from "../pipeline/seed.js";
import type * as pipeline_states from "../pipeline/states.js";
import type * as pipeline_steps from "../pipeline/steps.js";
import type * as pipeline_transitions from "../pipeline/transitions.js";
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
  "pipeline/hmac": typeof pipeline_hmac;
  "pipeline/ingestion": typeof pipeline_ingestion;
  "pipeline/objectStore": typeof pipeline_objectStore;
  "pipeline/queries": typeof pipeline_queries;
  "pipeline/reviewItems": typeof pipeline_reviewItems;
  "pipeline/runs": typeof pipeline_runs;
  "pipeline/seed": typeof pipeline_seed;
  "pipeline/states": typeof pipeline_states;
  "pipeline/steps": typeof pipeline_steps;
  "pipeline/transitions": typeof pipeline_transitions;
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
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
