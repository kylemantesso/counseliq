import { useSyncExternalStore } from "react";

/**
 * Tiny external store for the unit clock. The audio engine publishes
 * unitClockMs here on every animation frame; only leaf consumers
 * (CardLayer, CaptionBar, the scrub bar) subscribe, so 60fps updates never
 * re-render the whole player tree.
 */

export interface UnitClockStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): number;
  set(ms: number): void;
}

export function createUnitClock(initialMs = 0): UnitClockStore {
  let clockMs = initialMs;
  const listeners = new Set<() => void>();
  return {
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot() {
      return clockMs;
    },
    set(ms) {
      if (ms === clockMs) return;
      clockMs = ms;
      for (const listener of listeners) listener();
    },
  };
}

/** Subscribe a component to the unit clock (re-renders each published frame). */
export function useUnitClock(store: UnitClockStore): number {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
