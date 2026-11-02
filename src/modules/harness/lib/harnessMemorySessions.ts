import { createHarnessMemoryDelivery } from "@/modules/harness/lib/harnessMemoryDelivery";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import {
  createMemoryConversations,
  qualifyMemoryConversation,
} from "@/modules/workspace-kit/lib/memoryConversations";
import {
  harnessProjectEnvironmentFor,
  useHarnessProjectEnvStore,
} from "@/modules/harness/lib/harnessEnvStore";
import { supportsRemoteAgent } from "@/modules/harness/lib/harness/remoteAgents";
import type { HarnessId } from "@/modules/harness/lib/session";

export type HarnessMemorySession = MemoryConversation;

export function createHarnessMemorySessions() {
  const manager = createMemoryConversations(createHarnessMemoryDelivery);
  const captures = new Map<
    object,
    {
      project: string;
      key: string;
      retired: boolean;
      session: HarnessMemorySession | null;
    }
  >();
  const environment = (project: string) =>
    harnessProjectEnvironmentFor(
      project,
      useHarnessProjectEnvStore.getState().projects,
    );
  const unsubscribe = useHarnessProjectEnvStore.subscribe(() => {
    for (const capture of captures.values()) {
      if (
        !capture.retired &&
        JSON.stringify(environment(capture.project)) !== capture.key
      ) {
        capture.retired = true;
        void capture.session?.close().catch(() => undefined);
      }
    }
  });
  return {
    ...manager,
    capture(
      owner: object,
      projectCwd: string,
      cwd: string,
      isOwnerCurrent: () => boolean,
      supportsDelivery = false,
      harness?: HarnessId,
    ) {
      const selected = environment(projectCwd);
      if (selected.connecting || selected.error)
        throw Object.assign(new Error("Memory conversation cancelled"), {
          code: "cancelled",
        });
      const key = JSON.stringify(selected);
      const previous = captures.get(owner);
      if (previous && (previous.key !== key || previous.project !== projectCwd))
        previous.retired = true;
      const capture =
        previous && !previous.retired
          ? previous
          : {
              project: projectCwd,
              key,
              retired: false,
              session: null as HarnessMemorySession | null,
            };
      const session = manager.capture(
        owner,
        projectCwd,
        cwd,
        () =>
          !capture.retired &&
          isOwnerCurrent() &&
          JSON.stringify(environment(projectCwd)) === key,
        supportsDelivery &&
          (cwd.startsWith("remote://")
            ? harness !== undefined && supportsRemoteAgent(harness)
            : selected.env.kind === "local"),
        selected.env,
      );
      capture.session = session;
      captures.set(owner, capture);
      return session;
    },
    reconcile(owners: Iterable<object>) {
      const current = new Set(owners);
      manager.reconcile(current);
      for (const owner of captures.keys())
        if (!current.has(owner)) captures.delete(owner);
    },
    dispose() {
      unsubscribe();
      captures.clear();
      manager.dispose();
    },
  };
}

export const qualifyHarnessMemorySession = qualifyMemoryConversation;
