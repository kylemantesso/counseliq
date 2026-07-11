"use client";

/**
 * Mount point for Clerk's Smart CAPTCHA in custom sign-up flows (web only).
 * Clerk looks up this element by id and renders the widget into it; without
 * it, Clerk logs a console error and falls back to invisible CAPTCHA.
 * https://clerk.com/docs/guides/development/custom-flows/authentication/bot-sign-up-protection
 */
export function ClerkCaptcha() {
  return <div id="clerk-captcha" />;
}
