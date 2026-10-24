import { describe, expect, it } from "vitest";
import { planCommitHistoryOpen, type GitHistoryTab, type Tab } from "./useTabs";
import { createTabIdentity } from "./tabIdentity";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";

function history(
  id: number,
  repoRoot: string,
  spaceId = "space-a",
): GitHistoryTab {
  return {
    id,
    ...createTabIdentity(spaceId, () => `history-${id}`),
    kind: "git-history",
    spaceId,
    title: "Git History",
    repoRoot,
  };
}

describe("planCommitHistoryOpen", () => {
  const ssh: Extract<WorkspaceEnv, { kind: "ssh" }> = {
    kind: "ssh",
    connection: {
      id: "profile-a",
      name: "Host A",
      host: "host-a",
      user: "dev",
    },
    root: "/repos",
    sessionId: 11,
  };

  it.each<[string, WorkspaceEnv, WorkspaceEnv]>([
    ["local and SSH", LOCAL_WORKSPACE, ssh],
    ["SSH and local", ssh, LOCAL_WORKSPACE],
    ["local and WSL", LOCAL_WORKSPACE, { kind: "wsl", distro: "Debian" }],
    [
      "WSL distributions",
      { kind: "wsl", distro: "Debian" },
      { kind: "wsl", distro: "Ubuntu" },
    ],
    [
      "SSH profiles",
      ssh,
      { ...ssh, connection: { ...ssh.connection, id: "profile-b" } },
    ],
    [
      "SSH hosts under one profile",
      ssh,
      { ...ssh, connection: { ...ssh.connection, host: "host-b" } },
    ],
    [
      "SSH users",
      ssh,
      { ...ssh, connection: { ...ssh.connection, user: "other" } },
    ],
    [
      "SSH ports",
      ssh,
      { ...ssh, connection: { ...ssh.connection, port: 2222 } },
    ],
    [
      "SSH identities",
      ssh,
      {
        ...ssh,
        connection: { ...ssh.connection, identityFile: "/keys/other" },
      },
    ],
    [
      "SSH options",
      ssh,
      { ...ssh, connection: { ...ssh.connection, extraArgs: "-J bastion" } },
    ],
    ["SSH roots", ssh, { ...ssh, root: "/other" }],
    [
      "Docker containers",
      {
        kind: "docker",
        connection: { containerId: "a", containerName: "A", image: "image" },
      },
      {
        kind: "docker",
        connection: { containerId: "b", containerName: "B", image: "image" },
      },
    ],
    [
      "Docker users",
      {
        kind: "docker",
        connection: {
          containerId: "a",
          containerName: "A",
          image: "image",
          user: "dev",
        },
      },
      {
        kind: "docker",
        connection: {
          containerId: "a",
          containerName: "A",
          image: "image",
          user: "other",
        },
      },
    ],
  ])(
    "keeps the original history when opening the same path across %s",
    (_label, originalEnv, nextEnv) => {
      const original = {
        ...history(1, "/repos/shared"),
        workspaceEnv: originalEnv,
      };
      const tabs = [original];
      const result = planCommitHistoryOpen(
        tabs,
        { repoRoot: "/repos/shared", workspaceEnv: nextEnv },
        "space-a",
        () => 2,
      );

      expect(result.targetId).toBe(2);
      expect(result.tabs).toHaveLength(2);
      expect(result.tabs[0]).toBe(original);
      expect(original.workspaceEnv).toBe(originalEnv);
      expect(result.tabs[1]).toMatchObject({ id: 2, workspaceEnv: nextEnv });
      expect(tabs).toEqual([original]);
    },
  );

  it("refreshes the native session for the same SSH repository without replacing its identity", () => {
    const original = { ...history(1, "/repos/shared"), workspaceEnv: ssh };
    const reconnected = {
      ...ssh,
      sessionId: 12,
      connection: { ...ssh.connection, port: 22, name: "Renamed" },
    };
    const result = planCommitHistoryOpen(
      [original],
      { repoRoot: "/repos/shared", branch: "main", workspaceEnv: reconnected },
      "space-a",
      () => {
        throw new Error("Must reuse the same repository");
      },
    );

    expect(result.targetId).toBe(1);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0]).toMatchObject({
      tabKey: original.tabKey,
      workspaceEnv: reconnected,
      title: "History · main",
    });
    expect(original.workspaceEnv).toBe(ssh);
  });

  it("uses the current environment for an unqualified opening without retargeting a saved remote history", () => {
    const original = { ...history(1, "/repos/shared"), workspaceEnv: ssh };
    const previous = useWorkspaceEnvStore.getState().env;
    useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
    try {
      const result = planCommitHistoryOpen(
        [original],
        { repoRoot: "/repos/shared" },
        "space-a",
        () => 2,
      );
      expect(result.targetId).toBe(2);
      expect(result.tabs[0]).toBe(original);
      expect(result.tabs[1]).toMatchObject({ workspaceEnv: LOCAL_WORKSPACE });
    } finally {
      useWorkspaceEnvStore.setState({ env: previous });
    }
  });

  it("selects the matching environment among histories with the same path", () => {
    const local = {
      ...history(1, "/repos/shared"),
      workspaceEnv: LOCAL_WORKSPACE,
    };
    const remote = { ...history(2, "/repos/shared"), workspaceEnv: ssh };
    const result = planCommitHistoryOpen(
      [local, remote],
      { repoRoot: "/repos/shared", workspaceEnv: ssh },
      "space-a",
      () => {
        throw new Error("Matching history already exists");
      },
    );
    expect(result.targetId).toBe(2);
    expect(result.tabs).toEqual([local, remote]);
    expect(result.tabs[0]).toBe(local);
  });

  it("keeps legacy histories local when the current workspace is remote", () => {
    const original = history(1, "/repos/shared");
    const previous = useWorkspaceEnvStore.getState().env;
    useWorkspaceEnvStore.setState({ env: ssh });
    try {
      const remote = planCommitHistoryOpen(
        [original],
        { repoRoot: "/repos/shared" },
        "space-a",
        () => 2,
      );
      expect(remote.targetId).toBe(2);
      expect(remote.tabs[0]).toBe(original);
      expect(remote.tabs[1]).toMatchObject({ workspaceEnv: ssh });

      const local = planCommitHistoryOpen(
        remote.tabs,
        { repoRoot: "/repos/shared", workspaceEnv: LOCAL_WORKSPACE },
        "space-a",
        () => {
          throw new Error("Legacy local history already exists");
        },
      );
      expect(local.targetId).toBe(1);
      expect(local.tabs[1]).toBe(remote.tabs[1]);
      expect(original.workspaceEnv).toBeUndefined();
    } finally {
      useWorkspaceEnvStore.setState({ env: previous });
    }
  });

  it.each<WorkspaceEnv>([
    LOCAL_WORKSPACE,
    { kind: "wsl", distro: "Debian" },
    {
      kind: "docker",
      connection: {
        containerId: "a",
        containerName: "A",
        image: "image",
        user: "dev",
      },
    },
  ])("reuses a history for a copied $kind environment", (workspaceEnv) => {
    const original = { ...history(1, "/repos/shared"), workspaceEnv };
    const result = planCommitHistoryOpen(
      [original],
      { repoRoot: "/repos/shared", workspaceEnv: { ...workspaceEnv } },
      "space-a",
      () => {
        throw new Error("Matching history already exists");
      },
    );
    expect(result.targetId).toBe(1);
    expect(result.tabs[0]).toBe(original);
  });

  it("reuses a repository history tab within the active Space", () => {
    const existing = history(1, "/repos/a");
    let allocations = 0;
    const result = planCommitHistoryOpen(
      [existing],
      { repoRoot: "/repos/a", branch: "main" },
      "space-a",
      () => {
        allocations += 1;
        return 2;
      },
    );

    expect(result.targetId).toBe(1);
    expect(result.tabs[0]).toMatchObject({ title: "History · main" });
    expect(allocations).toBe(0);

    const repeated = planCommitHistoryOpen(
      result.tabs,
      { repoRoot: "/repos/a", branch: "main" },
      "space-a",
      () => 2,
    );
    expect(repeated.tabs).toBe(result.tabs);
  });

  it("opens separate tabs for separate repositories", () => {
    const existing = history(1, "/repos/a");
    const result = planCommitHistoryOpen(
      [existing],
      { repoRoot: "/repos/b", branch: "feature" },
      "space-a",
      () => 2,
    );

    expect(result.targetId).toBe(2);
    expect(result.tabs).toEqual([
      existing,
      expect.objectContaining({
        id: 2,
        repoRoot: "/repos/b",
        spaceId: "space-a",
        title: "History · feature",
      }),
    ]);
  });

  it("does not activate a matching repository tab from another Space", () => {
    const otherSpace = history(1, "/repos/shared", "space-b");
    const tabs: Tab[] = [otherSpace];
    const result = planCommitHistoryOpen(
      tabs,
      { repoRoot: "/repos/shared" },
      "space-a",
      () => 2,
    );

    expect(result.targetId).toBe(2);
    expect(result.tabs).toEqual([
      otherSpace,
      expect.objectContaining({
        id: 2,
        repoRoot: "/repos/shared",
        spaceId: "space-a",
      }),
    ]);
  });
});
