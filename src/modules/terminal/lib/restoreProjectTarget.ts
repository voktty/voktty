import {
  ownedPtyTargets,
  type OwnedPtyTarget,
} from "@/modules/terminal/lib/ownedPtyTargets";
import {
  terminalRestoreCwd,
  terminalRestoreProject,
} from "@/modules/tabs/lib/terminalProjectRestore";
import type { ProjectTerminalTarget } from "@/modules/harness/lib/projectTerminalTarget";

function owned(target: ProjectTerminalTarget, cwd: string): OwnedPtyTarget {
  const acquireSibling = target.acquireSibling;
  const lease = target.lease;
  return {
    cwd,
    workspace: target.workspace,
    release: () => {
      if (lease.releaseAndClose) return lease.releaseAndClose();
      lease.release();
      return Promise.resolve();
    },
    acquireSibling:
      acquireSibling &&
      (async (folder) => owned(await acquireSibling(folder), folder)),
  };
}

export function reserveRestoredProjectTarget(
  leafId: number,
  projectCwd: string,
  cwd?: string,
) {
  if (!terminalRestoreProject(projectCwd))
    throw new Error("Remote terminal project is invalid.");
  const initialFolder = terminalRestoreCwd(projectCwd, cwd);
  ownedPtyTargets.retryCleanup();
  return ownedPtyTargets.reserve(leafId, async (next) => {
    const receipt = ownedPtyTargets.get(leafId);
    const isCurrent = () =>
      receipt?.isCurrent() === true && ownedPtyTargets.get(leafId) === receipt;
    const folder = terminalRestoreCwd(projectCwd, next ?? initialFolder);
    const { openProjectTerminalTarget } = await import(
      "@/modules/harness/lib/projectTerminalTarget"
    );
    const target = await openProjectTerminalTarget(
      projectCwd,
      undefined,
      isCurrent,
    );
    if (!target) throw new Error("Remote terminal connection was retired.");
    return owned(
      {
        ...target,
        workspace: { ...target.workspace, restoredProjectCwd: projectCwd },
      },
      folder,
    );
  });
}
