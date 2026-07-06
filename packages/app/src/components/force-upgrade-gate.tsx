"use client";

import { useEffect, type ReactNode } from "react";
import { useForceUpgradeState } from "../version/use-force-upgrade";
import { ForceUpgradeScreen } from "../screens/force-upgrade-screen";

type ForceUpgradeGateProps = {
  children: ReactNode;
  /**
   * Fired when the gate decides to show the upgrade screen. Hosts use this to
   * dismiss the native splash — while an upgrade is forced the app tree (and
   * its own splash handling) never mounts, so the splash has to be hidden here
   * or it would stay up forever and cover the upgrade screen.
   *
   * Not called on the happy path: when no upgrade is needed the children mount
   * and dismiss the splash once auth bootstrap is ready, avoiding a flash.
   */
  onUpgradeRequired?: () => void;
};

/**
 * Boot-time gate that blocks the entire app when the running native build is
 * below the minimum supported version. Render it directly inside the Convex
 * provider (so the public version query can run) and above auth/navigation so
 * nothing else mounts when an upgrade is forced.
 *
 * While the check loads we render `null` so the native splash stays up — no
 * flash of the app before the upgrade screen appears. On web the check is a
 * no-op and children render immediately.
 */
export function ForceUpgradeGate({
  children,
  onUpgradeRequired,
}: ForceUpgradeGateProps) {
  const state = useForceUpgradeState();

  useEffect(() => {
    if (state === "required") {
      onUpgradeRequired?.();
    }
  }, [state, onUpgradeRequired]);

  if (state === "loading") {
    return null;
  }

  if (state === "required") {
    return <ForceUpgradeScreen />;
  }

  return <>{children}</>;
}
