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
  if (unit.timing) return { label: `✓ ${formatMs(unit.timing.totalDurationMs)}`, color: "#7fd1a8", bg: "transparent" };
  return { label: unit.state.replace(/_/g, " "), color: "#9aa3ad", bg: "transparent" };
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
        borderRight: "1px solid #262b31",
        padding: "12px 10px",
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {modules.map((module, mi) => (
        <div key={module.moduleKey} style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "#9aa3ad",
              padding: "6px 8px",
            }}
          >
            Module {mi + 1} · {module.moduleTitle}
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
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 8px",
                    borderRadius: 8,
                    border: "none",
                    background: active ? "#20262d" : "transparent",
                    color: "#e8e6e1",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.unit.unitKey} · {f.unit.concept.replace(/-/g, " ")}
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
                  </span>
                </button>
              );
            })}
        </div>
      ))}
    </nav>
  );
}
