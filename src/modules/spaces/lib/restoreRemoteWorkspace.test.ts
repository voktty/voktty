import type { Tab } from "@/modules/tabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { WorkspaceEnv } from "@/modules/workspace";
import { describe, expect, it } from "vitest";
import { bindRestoredSshSession } from "./restoreRemoteWorkspace";
import type { SpaceMeta } from "./store";

const persistedSsh: Extract<WorkspaceEnv, { kind: "ssh" }> = {
  kind: "ssh",
  connection: {
    id: "server-1",
    name: "Build server",
    host: "build.example.com",
    user: "deploy",
  },
  root: "/srv/app",
};

const connectedSsh: Extract<WorkspaceEnv, { kind: "ssh" }> = {
  ...persistedSsh,
  sessionId: 42,
};

function space(id: string, env: WorkspaceEnv): SpaceMeta {
  return {
    id,
    name: id,
    root: env.kind === "ssh" ? env.root : null,
    env,
    createdAt: 0,
    updatedAt: 0,
  };
}

function terminal(
  id: number,
  spaceId: string,
  workspaceEnv?: WorkspaceEnv,
): Tab {
  return {
    id,
    ...createTabIdentity(spaceId, () => `restore-${id}`),
    kind: "terminal",
    spaceId,
    cold: true,
    title: "shell",
    paneTree: { kind: "leaf", id: id + 100, cwd: "/srv/app" },
    activeLeafId: id + 100,
    ...(workspaceEnv && { workspaceEnv }),
  };
}

describe("bindRestoredSshSession", () => {
  it("binds the connected session before the active restored terminal can warm", () => {
    const spaces = [
      space("active", persistedSsh),
      space("other", { kind: "local" }),
    ];
    const local = terminal(2, "active", { kind: "local" });
    const otherSpace = terminal(3, "other", persistedSsh);
    const result = bindRestoredSshSession({
      spaces,
      tabs: [terminal(1, "active", persistedSsh), local, otherSpace],
      activeSpaceId: "active",
      requested: persistedSsh,
      prepared: connectedSsh,
    });

    expect(result.spaces[0]).toMatchObject({
      root: "/srv/app",
      env: { kind: "ssh", sessionId: 42 },
    });
    expect(result.tabs[0]).toMatchObject({
      workspaceEnv: { kind: "ssh", sessionId: 42 },
    });
    expect(result.tabs[1]).toBe(local);
    expect(result.tabs[2]).toBe(otherSpace);
  });

  it("binds legacy terminals that relied on the space SSH environment", () => {
    const result = bindRestoredSshSession({
      spaces: [space("active", persistedSsh)],
      tabs: [terminal(1, "active")],
      activeSpaceId: "active",
      requested: persistedSsh,
      prepared: connectedSsh,
    });

    expect(result.tabs[0]).toMatchObject({
      workspaceEnv: { kind: "ssh", sessionId: 42 },
    });
  });

  it("leaves restored state untouched when SSH did not connect", () => {
    const spaces = [space("active", persistedSsh)];
    const tabs = [terminal(1, "active", persistedSsh)];

    expect(
      bindRestoredSshSession({
        spaces,
        tabs,
        activeSpaceId: "active",
        requested: persistedSsh,
        prepared: null,
      }),
    ).toEqual({ spaces, tabs });
  });
});
