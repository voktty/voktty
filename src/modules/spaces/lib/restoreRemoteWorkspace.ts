import type { Tab } from "@/modules/tabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { SpaceMeta } from "./store";

type SshWorkspaceEnv = Extract<WorkspaceEnv, { kind: "ssh" }>;

type BindRestoredSshSessionInput = {
  spaces: SpaceMeta[];
  tabs: Tab[];
  activeSpaceId: string;
  requested: WorkspaceEnv;
  prepared: WorkspaceEnv | null;
};

function isRestoredSshWorkspace(
  env: WorkspaceEnv,
  requested: SshWorkspaceEnv,
  prepared: SshWorkspaceEnv,
): boolean {
  return (
    env.kind === "ssh" &&
    env.connection.id === requested.connection.id &&
    (env.root === requested.root || env.root === prepared.root)
  );
}

export function bindRestoredSshSession({
  spaces,
  tabs,
  activeSpaceId,
  requested,
  prepared,
}: BindRestoredSshSessionInput): { spaces: SpaceMeta[]; tabs: Tab[] } {
  if (
    requested.kind !== "ssh" ||
    prepared?.kind !== "ssh" ||
    prepared.sessionId === undefined ||
    prepared.connection.id !== requested.connection.id
  ) {
    return { spaces, tabs };
  }

  const restoredSpaces = spaces.map((space) =>
    space.id === activeSpaceId &&
    isRestoredSshWorkspace(space.env, requested, prepared)
      ? { ...space, root: prepared.root, env: prepared }
      : space,
  );

  const restoredTabs = tabs.map((tab) => {
    if (tab.kind !== "terminal" || tab.spaceId !== activeSpaceId) return tab;
    if (
      tab.workspaceEnv &&
      !isRestoredSshWorkspace(tab.workspaceEnv, requested, prepared)
    ) {
      return tab;
    }
    return { ...tab, workspaceEnv: prepared };
  });

  return { spaces: restoredSpaces, tabs: restoredTabs };
}
