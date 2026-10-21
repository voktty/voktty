import { useSyncExternalStore } from "react";
import type {
  createHarnessSessionRuntime,
  HarnessSessionRuntimeSnapshot,
} from "@/modules/harness/lib/harnessSessionRuntime";

/** Reads an injected runtime only; view registration and imperative ownership stay with explicit adapters. */
export function useHarnessSessions(
  runtime: Pick<
    ReturnType<typeof createHarnessSessionRuntime>,
    "subscribe" | "getSnapshot"
  >,
): HarnessSessionRuntimeSnapshot {
  return useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
}
