import { CardRenderer, SETTLED_TIMING, cssVar } from "@counseliq/cards";
import type { PreviewAnchor } from "./types";
import { withInstitutionLogoOnTitleCard } from "../../theme/brand-tokens";

/** The unit's settled takeaway card + continue CTA. */
export function AnchorPhase({
  anchor,
  institutionLogoUrl,
  continueLabel,
  onDone,
}: {
  anchor: PreviewAnchor | null;
  institutionLogoUrl?: string | null;
  continueLabel: string;
  onDone: () => void;
}) {
  return (
    <div style={{ position: "absolute", inset: 0, background: cssVar("bg") }}>
      {anchor ? (
        <CardRenderer
          template={anchor.template}
          props={withInstitutionLogoOnTitleCard(
            anchor.template,
            anchor.props,
            institutionLogoUrl
          )}
          timing={SETTLED_TIMING}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: 24,
          right: 24,
          bottom: 14,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={onDone}
          style={{
            width: "100%",
            minHeight: 48,
            border: 0,
            borderRadius: 999,
            background: cssVar("accent"),
            color: cssVar("accentInk"),
            fontFamily: cssVar("fontMono"),
            fontSize: 12.5,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          {continueLabel}
        </button>
      </div>
    </div>
  );
}
