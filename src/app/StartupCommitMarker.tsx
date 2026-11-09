import { useLayoutEffect } from "react";
import { markStartupPhase } from "@/lib/startupTiming";
import { revealWindow } from "@/lib/windowReveal";

export function StartupCommitMarker() {
  useLayoutEffect(() => {
    markStartupPhase("react-committed");
    revealWindow();
  }, []);
  return null;
}
