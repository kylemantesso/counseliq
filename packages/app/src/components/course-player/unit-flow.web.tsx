import { useEffect, useRef, useState } from "react";
import type { UnitClockStore } from "./clock-store.web";
import { AnchorPhase } from "./anchor-phase.web";
import { ContentPhase } from "./content-phase.web";
import { HookPhase } from "./hook-phase.web";
import { RetrievePhase } from "./retrieve-phase.web";
import { nextPhase, phasesForUnit } from "./timeline-helpers";
import type { PreviewQuestion, PreviewUnit, UnitPhase } from "./types";
import type { UnitAudioControls } from "./use-unit-audio.web";

/**
 * Per-unit phase machine: hook → content → retrieve → anchor. The studio
 * exposes the phases as clickable pills (parent renders them via
 * usePhaseState); content auto-advances to retrieve when the audio ends.
 */

export interface UnitFlowState {
  phase: UnitPhase;
  phases: UnitPhase[];
  setPhase: (phase: UnitPhase) => void;
  advance: () => void;
}

export function useUnitFlow(unit: PreviewUnit, onUnitComplete: () => void): UnitFlowState {
  const phases = phasesForUnit(unit);
  const [phase, setPhase] = useState<UnitPhase>(phases[0]);
  const unitRef = useRef(unit);
  unitRef.current = unit;

  // New unit → restart at its first phase. Keyed by unit id, not object
  // identity, so reactive data refreshes (e.g. an edit re-synthesising the
  // unit) don't kick the reviewer back to the hook.
  const unitId = unit.id;
  useEffect(() => {
    setPhase(phasesForUnit(unitRef.current)[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  const advance = () => {
    const next = nextPhase(unit, phase);
    if (next) setPhase(next);
    else onUnitComplete();
  };

  return { phase, phases, setPhase, advance };
}

export interface UnitFlowProps {
  unit: PreviewUnit;
  flow: UnitFlowState;
  questionsById: Map<string, PreviewQuestion>;
  clock: UnitClockStore;
  audio: UnitAudioControls;
  reducedMotion: boolean;
  institutionLogoUrl?: string | null;
  isLastUnit: boolean;
  onEditSentence?: (narrationId: string) => void;
}

export function UnitFlow({
  unit,
  flow,
  questionsById,
  clock,
  audio,
  reducedMotion,
  institutionLogoUrl,
  isLastUnit,
  onEditSentence,
}: UnitFlowProps) {
  switch (flow.phase) {
    case "hook": {
      const ref = unit.meta.hook?.questionRef;
      return (
        <HookPhase
          question={(ref && questionsById.get(ref)) || null}
          onDone={flow.advance}
        />
      );
    }
    case "content":
      return (
        <ContentPhase
          unit={unit}
          clock={clock}
          audio={audio}
          reducedMotion={reducedMotion}
          institutionLogoUrl={institutionLogoUrl}
          onEditSentence={onEditSentence}
        />
      );
    case "retrieve": {
      const questions = (unit.meta.retrieve ?? [])
        .map((ref) => questionsById.get(ref))
        .filter((q): q is PreviewQuestion => Boolean(q));
      return <RetrievePhase questions={questions} onDone={flow.advance} />;
    }
    case "anchor":
      return (
        <AnchorPhase
          anchor={unit.meta.anchor ?? null}
          institutionLogoUrl={institutionLogoUrl}
          continueLabel={isLastUnit ? "Finish course" : "Next unit"}
          onDone={flow.advance}
        />
      );
  }
}
