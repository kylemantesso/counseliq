export type OAuthResult =
  | { type: "complete"; sessionId?: string }
  | { type: "cancelled" }
  | { type: "redirect" }
  | { type: "incomplete" };
