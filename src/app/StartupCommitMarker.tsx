import { markStartupPhase } from "@/lib/startupTiming";
import { useEffect } from "react";

export function StartupCommitMarker() {
  useEffect(() => {
    markStartupPhase("react-committed");
  }, []);
  return null;
}
