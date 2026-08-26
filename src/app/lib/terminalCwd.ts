import type { Tab } from "@/modules/tabs";
import { hasLeaf } from "@/modules/terminal";
import type { WorkspaceEnv } from "@/modules/workspace";

export type TerminalCwdTarget = {
  workspaceEnv: WorkspaceEnv;
  authorizeLocally: boolean;
};

export function terminalCwdTarget(
  tabs: readonly Tab[],
  leafId: number,
  fallbackEnv: WorkspaceEnv,
): TerminalCwdTarget | null {
  const tab = tabs.find(
    (candidate) =>
      candidate.kind === "terminal" && hasLeaf(candidate.paneTree, leafId),
  );
  if (tab?.kind !== "terminal") return null;
  const workspaceEnv = tab.workspaceEnv ?? fallbackEnv;
  return {
    workspaceEnv,
    authorizeLocally: workspaceEnv.kind !== "ssh",
  };
}
