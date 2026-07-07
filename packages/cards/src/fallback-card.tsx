import { cssVar } from "./theme/brand-theme-provider";

/**
 * Settled, motionless fallback for unknown templates and render errors —
 * keeps review surfaces informative instead of blank.
 */
export interface FallbackCardProps {
  template: string;
  props: Record<string, unknown>;
  note?: string;
}

export function FallbackCard({ template, props, note }: FallbackCardProps) {
  let dump: string;
  try {
    dump = JSON.stringify(props, null, 2);
  } catch {
    dump = "(unserialisable props)";
  }
  return (
    <div
      data-ciq-fallback=""
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 24,
        background: cssVar("bg"),
        color: cssVar("ink"),
        fontFamily: cssVar("fontText"),
      }}
    >
      <div
        style={{
          fontFamily: cssVar("fontMono"),
          fontSize: 11,
          color: cssVar("accent"),
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {template}
      </div>
      {note ? (
        <div style={{ fontSize: 12, color: cssVar("dim") }}>{note}</div>
      ) : null}
      <pre
        style={{
          margin: 0,
          padding: 12,
          flex: 1,
          overflow: "hidden",
          fontFamily: cssVar("fontMono"),
          fontSize: 10,
          lineHeight: 1.5,
          color: cssVar("dim"),
          background: cssVar("chip"),
          borderRadius: cssVar("radiusSm"),
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {dump}
      </pre>
    </div>
  );
}
