import type { FlatUnit } from "./timeline-helpers";
import { formatMs } from "./timeline-helpers";
import type { PreviewModule, PreviewUnit } from "./types";

/**
 * Studio navigation: modules → units, one row per unit with a state chip.
 * Blocked/failed units carry prominent badges; any unit is one click away.
 * Studio chrome styling (fixed palette), not brand tokens.
 */

export interface ModuleRailProps {
  modules: PreviewModule[];
  flatUnits: FlatUnit[];
  activeFlatIndex: number;
  onSelectUnit: (flatIndex: number) => void;
}

function stateChip(unit: PreviewUnit): { label: string; color: string; bg: string } {
  if (unit.state === "blocked") return { label: "BLOCKED", color: "#fff", bg: "#c53030" };
  if (unit.error) return { label: "FAILED", color: "#fff", bg: "#b45309" };
  if (unit.timing) return { label: formatMs(unit.timing.totalDurationMs), color: "#49d17f", bg: "transparent" };
  return { label: unit.state.replace(/_/g, " "), color: "#9aa3ad", bg: "transparent" };
}

function moduleDuration(module: PreviewModule): number {
  return module.units.reduce((sum, unit) => sum + (unit.timing?.totalDurationMs ?? 0), 0);
}

function unitDisplayLabel(unit: FlatUnit): string {
  return `${unit.moduleIndex + 1}.${unit.unitIndexInModule + 1}`;
}

export function ModuleRail({ modules, flatUnits, activeFlatIndex, onSelectUnit }: ModuleRailProps) {
  return (
    <nav
      data-ciq-module-rail=""
      aria-label="Course modules"
      style={{
        width: 272,
        flex: "0 0 auto",
        overflowY: "auto",
        borderRight: "1px solid #202833",
        background: "#0b1016",
        padding: "22px 12px 16px",
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      <div
        style={{
          padding: "0 8px 14px",
          borderBottom: "1px solid #1f2732",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            color: "#737d88",
            fontSize: 10,
            letterSpacing: ".18em",
            textTransform: "uppercase",
          }}
        >
          Course outline
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            marginTop: 8,
            color: "#e8e6e1",
            fontSize: 11,
          }}
        >
          <span>{modules.length} modules · {flatUnits.length} units</span>
          <span style={{ color: "#51d083" }}>
            {formatMs(flatUnits.reduce((sum, f) => sum + (f.unit.timing?.totalDurationMs ?? 0), 0))} total
          </span>
        </div>
      </div>
      {modules.map((module, mi) => (
        <div key={module.moduleKey} style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "#747e8a",
              padding: "6px 8px",
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span>Module {mi + 1} · {module.moduleTitle}</span>
            <span style={{ color: "#51d083" }}>{formatMs(moduleDuration(module))}</span>
          </div>
          {flatUnits
            .filter((f) => f.moduleIndex === mi)
            .map((f) => {
              const chip = stateChip(f.unit);
              const active = f.flatIndex === activeFlatIndex;
              return (
                <button
                  key={f.unit.unitKey}
                  type="button"
                  onClick={() => onSelectUnit(f.flatIndex)}
                  aria-current={active ? "true" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 9,
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 8px",
                    borderRadius: 8,
                    border: active ? "1px solid #8b7427" : "1px solid transparent",
                    background: active ? "rgba(214,173,47,.16)" : "transparent",
                    color: "#e8e6e1",
                    cursor: "pointer",
                    fontSize: 11.5,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span
                      style={{
                        flex: "0 0 auto",
                        minWidth: 24,
                        color: active ? "#11100c" : "#78828f",
                        background: active ? "#d6ad2f" : "#151d26",
                        borderRadius: 5,
                        padding: "2px 4px",
                        textAlign: "center",
                        fontSize: 10,
                        fontWeight: 800,
                      }}
                    >
                      {unitDisplayLabel(f)}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.unit.concept.replace(/-/g, " ")}
                    </span>
                  </span>
                  <span
                    style={{
                      flex: "0 0 auto",
                      fontSize: 9,
                      letterSpacing: ".08em",
                      color: chip.color,
                      background: chip.bg,
                      borderRadius: 4,
                      padding: chip.bg === "transparent" ? 0 : "2px 6px",
                    }}
                  >
                    {chip.label}
                    {f.unit.timing && !f.unit.error && f.unit.state !== "blocked" ? (
                      <span style={{ marginLeft: 5, fontSize: 9 }}>●</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
        </div>
      ))}
    </nav>
  );
}
