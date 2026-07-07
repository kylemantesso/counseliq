import type { ComponentType } from "react";
import type { CardComponentProps } from "../timing";

/**
 * Template name → component registry. Batches A3–A5 fill this as each
 * template lands; CardRenderer falls back for anything absent. The
 * determinism test iterates this record, so new templates are covered
 * automatically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TEMPLATE_COMPONENTS: Record<string, ComponentType<CardComponentProps<any>>> = {};
