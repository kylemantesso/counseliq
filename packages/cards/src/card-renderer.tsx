import { Component, type ReactNode } from "react";
import { FallbackCard } from "./fallback-card";
import { TEMPLATE_COMPONENTS } from "./templates/registry";
import type { CardTiming } from "./timing";

/**
 * Resolves a card's template name to its component and renders it with the
 * host-supplied timing. Unknown templates and thrown render errors both
 * degrade to FallbackCard — a review surface must never white-screen on a
 * malformed card.
 */

export interface CardRendererProps {
  template: string;
  props: Record<string, unknown>;
  timing: CardTiming;
}

interface BoundaryProps {
  fallback: ReactNode;
  /** Remounts the boundary when the card identity changes. */
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
}

class CardErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function CardRenderer({ template, props, timing }: CardRendererProps) {
  const Template = TEMPLATE_COMPONENTS[template];
  if (!Template) {
    return <FallbackCard template={template} props={props} note="No renderer registered for this template." />;
  }
  return (
    <CardErrorBoundary
      key={template}
      fallback={<FallbackCard template={template} props={props} note="This card failed to render." />}
    >
      <Template props={props} timing={timing} />
    </CardErrorBoundary>
  );
}
