import { createContext, useContext } from "react";
import {
  findModel,
  modelsFor,
  resolveModel,
  type AgentModel,
} from "@/modules/harness/lib/models";
import type { HarnessId } from "@/modules/harness/lib/session";
import {
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
} from "@/modules/harness/lib/harness/availability";
import { refreshHarnessCatalogs } from "@/modules/harness/lib/harness/registry";

/** Where the model picker gets its models and provider availability. The
 * default is this computer's catalog; a remote session supplies its host's. */
export type ModelSource = {
  /** Present only for non-local sources; local sources use global stores. */
  id?: string;
  modelsFor(harness: HarnessId): AgentModel[];
  resolve(harness: HarnessId, id?: string): AgentModel;
  find(id: string): AgentModel | undefined;
  available(harness: HarnessId): boolean;
  probed(): boolean;
  /** Refresh availability and catalogs, when the source supports it. */
  refresh(harnesses: HarnessId[]): void;
};

export const LOCAL_MODEL_SOURCE: ModelSource = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: isHarnessAvailable,
  probed: hasProbedHarnessAvailability,
  refresh: (harnesses) => {
    void probeHarnessAvailability();
    void refreshHarnessCatalogs(harnesses);
  },
};

export const ModelSourceContext =
  createContext<ModelSource>(LOCAL_MODEL_SOURCE);

export const useModelSource = () => useContext(ModelSourceContext);
