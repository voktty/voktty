import { useContext } from "react";
import { HarnessProjectOwner } from "@/modules/harness/hooks/useHarnessProjectSelection";
import {
  harnessProjectEnvironmentFor,
  useHarnessProjectEnvStore,
} from "@/modules/harness/lib/harnessEnvStore";
import { ProjectMemoryButton } from "@/modules/workspace-kit/components/ProjectMemoryButton";
import { useActiveSurfaceStore } from "@/modules/surfaces/lib/activeSurfaceStore";

export function HarnessProjectMemoryButton({ cwd }: { cwd: string }) {
  const owner = useContext(HarnessProjectOwner);
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
