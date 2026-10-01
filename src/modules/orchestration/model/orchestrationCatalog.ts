import { HARNESSES } from "@/modules/harness/lib/session";
import { modelsFor } from "@/modules/harness/lib/models";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
} from "@/modules/harness/lib/harness/availability";
import { refreshHarnessCatalogs } from "@/modules/harness/lib/harness/registry";
import { validateOrchestrationSettings } from "./orchestrationPlan";

/** Discover worker choices only when the user sends an orchestration request. */
export async function discoverOrchestrationSettings() {
  await probeHarnessAvailability();
  const installed = HARNESSES.filter(isHarnessAvailable);
  await refreshHarnessCatalogs(installed);
  return validateOrchestrationSettings({
    maxWorkers: 2,
    choices: installed
      .filter(isHarnessAvailable)
      .flatMap((harness) =>
        modelsFor(harness).map(({ id, name }) => ({
          harness,
          model: id,
          name,
        })),
      ),
  });
}
