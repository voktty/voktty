import { useContext, useRef } from "react";
import { HarnessWindowContext } from "@/modules/harness/components/HarnessWindowHost";
import { useWindowPersistenceAdmission } from "@/modules/harness/hooks/useWindowPersistenceAdmission";
import { captureHarnessMemoryConversation } from "@/modules/harness/lib/harnessMemoryConversation";
import type { MemoryConversationCapture } from "@/modules/workspace-kit/lib/memoryConversation";
import { HarnessProjectOwner } from "@/modules/harness/hooks/useHarnessProjectSelection";
import {
  harnessProjectEnvironmentFor,
  useHarnessProjectEnvStore,
} from "@/modules/harness/lib/harnessEnvStore";
import { ProjectMemoryButton } from "@/modules/workspace-kit/components/ProjectMemoryButton";
import { useActiveSurfaceStore } from "@/modules/surfaces/lib/activeSurfaceStore";

export function HarnessProjectMemoryButton({ cwd }: { cwd: string }) {
  const owner = useContext(HarnessProjectOwner);
  const runtime = useContext(HarnessWindowContext);
  const capture = useRef<MemoryConversationCapture | null>(null);
  const admission = useWindowPersistenceAdmission(() =>
    capture.current?.release(),
  );
  const directory = useActiveSurfaceStore(({ surface }) => {
    if (!owner) return cwd;
    if (surface.kind !== "harness" || surface.ownerId !== owner.ownerId)
      return null;
    return surface.project === cwd ? (surface.folder ?? cwd) : cwd;
  });
  const environment = useHarnessProjectEnvStore((state) =>
    harnessProjectEnvironmentFor(cwd, state.projects),
  );
  return (
    <ProjectMemoryButton
      rail
      captureConversation={() => {
        const permit = admission.getOwner()?.capture();
        if (!owner || !runtime || !permit || environment.env.kind !== "local")
          return null;
        const current = (sessionId?: string) => {
          const surface = useActiveSurfaceStore.getState().surface;
          const env = harnessProjectEnvironmentFor(
            cwd,
            useHarnessProjectEnvStore.getState().projects,
          );
          return (
            permit.isCurrent() &&
            !runtime.projects.has(cwd) &&
            (!sessionId || !runtime.holds.hasAny(sessionId)) &&
            !env.error &&
            !env.connecting &&
            env.env.kind === "local" &&
            surface.kind === "harness" &&
            surface.ownerId === owner.ownerId &&
            surface.project === cwd &&
            (surface.folder ?? cwd) === directory
          );
        };
        capture.current?.release();
        capture.current = captureHarnessMemoryConversation(
          runtime.engine,
          runtime.views,
          owner.ownerId,
          cwd,
          {
            isCurrent: current,
            subscribe(listener) {
              const subscriptions: (() => void)[] = [];
              try {
                for (const subscribe of [
                  useActiveSurfaceStore.subscribe,
                  useHarnessProjectEnvStore.subscribe,
                  runtime.holds.subscribe,
                  runtime.projects.subscribe,
                ])
                  subscriptions.push(subscribe(listener));
              } catch (error) {
                for (const unsubscribe of subscriptions) unsubscribe();
                throw error;
              }
              return () => {
                for (const unsubscribe of subscriptions) unsubscribe();
              };
            },
          },
        );
        return capture.current;
      }}
      target={
        directory &&
        directory !== "~" &&
        !environment.error &&
        !environment.connecting
          ? {
              path: directory,
              environment: environment.env,
              source: `harness:${owner?.ownerId ?? "standalone"}:${owner?.tabKey ?? ""}`,
            }
          : null
      }
    />
  );
}
