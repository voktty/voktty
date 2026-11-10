import type { WorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNetworkFilesystemPath,
  isPathWithinTree,
  matchesWatchEvent,
  watchEventPaths,
  normalizeWorkspaceEventPath,
  watchAdd,
  watchAddTree,
  watchRemove,
  watchRemoveTree,
} from "./watch";
import { recordRemoteSessionReplacement } from "@/modules/remote/sessionAliases";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const recovery = vi.hoisted(() => ({
  listener: undefined as undefined | ((lost: number, next: number) => void),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  onRemoteSessionRecovered: (
    listener: (lost: number, next: number) => void,
  ) => {
    recovery.listener = listener;
    return () => {};
  },
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: vi.fn() }),
}));

const remote: WorkspaceEnv = {
  kind: "ssh",
  root: "/srv/app",
  sessionId: 7,
  connection: {
    id: "server-1",
    name: "Server",
    host: "server.example",
  },
};

const wsl: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };

describe("filesystem watches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("re-registers remote watches on a recovered session and routes its events", () => {
    const lostEnv: WorkspaceEnv = { ...remote, sessionId: 41 };
    watchAdd(["/srv/app/src"], lostEnv);
    watchAddTree("/srv/app", lostEnv);
    vi.mocked(invoke).mockClear();

    recordRemoteSessionReplacement(41, 42);
    recovery.listener?.(41, 42);

    expect(invoke).toHaveBeenCalledWith("remote_watch_add", {
      sessionId: 42,
      paths: ["/srv/app/src"],
    });
    expect(invoke).toHaveBeenCalledWith("remote_watch_add_tree", {
      root: "/srv/app",
      sessionId: 42,
    });
    expect(
      matchesWatchEvent({ paths: ["/srv/app/src/a"], sessionId: 42 }, lostEnv),
    ).toBe(true);

    vi.mocked(invoke).mockClear();
    watchRemove(["/srv/app/src"], lostEnv);
    expect(invoke).toHaveBeenCalledWith("remote_watch_remove", {
      sessionId: 42,
      paths: ["/srv/app/src"],
    });
  });

  it("routes remote watch changes through their helper session", () => {
    watchAdd(["/srv/app", "/srv/app/src"], remote);
    watchRemove(["/srv/app/src"], remote);

    expect(invoke).toHaveBeenNthCalledWith(1, "remote_watch_add", {
      sessionId: 7,
      paths: ["/srv/app", "/srv/app/src"],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "remote_watch_remove", {
      sessionId: 7,
      paths: ["/srv/app/src"],
    });
  });

  it("keeps local watches on the native watcher", () => {
    watchAdd(["C:/project"], { kind: "local" });

    expect(invoke).toHaveBeenCalledWith("fs_watch_add", {
      paths: ["C:/project"],
      workspace: { kind: "local" },
    });
  });

  it("does not create native watchers for UNC shares", () => {
    watchAdd(["//server/share/project", "\\\\server\\share\\other"], {
      kind: "local",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(isNetworkFilesystemPath("//server/share/project")).toBe(true);
    expect(isNetworkFilesystemPath("\\\\server\\share\\project")).toBe(true);
    expect(isNetworkFilesystemPath("C:/project")).toBe(false);
  });

  it("routes WSL watches through the native watcher with its workspace", () => {
    watchAdd(["/home/serge/project"], wsl);
    watchRemove(["/home/serge/project"], wsl);

    expect(invoke).toHaveBeenNthCalledWith(1, "fs_watch_add", {
      paths: ["/home/serge/project"],
      workspace: wsl,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "fs_watch_remove", {
      paths: ["/home/serge/project"],
      workspace: wsl,
    });
  });

  it("delivers events only to the matching workspace", () => {
    expect(
      matchesWatchEvent({ paths: ["/srv/app/a"], sessionId: 7 }, remote),
    ).toBe(true);
    expect(
      matchesWatchEvent({ paths: ["/srv/app/a"], sessionId: 8 }, remote),
    ).toBe(false);
    expect(
      matchesWatchEvent({ paths: ["C:/project/a"] }, { kind: "local" }),
    ).toBe(true);
    expect(matchesWatchEvent({ paths: ["C:/project/a"] }, remote)).toBe(false);
  });

  it("still delivers local Windows events to a listener on an SSH Space", () => {
    expect(
      watchEventPaths({ paths: ["C:/project/a", "/srv/app/a"] }, remote),
    ).toEqual(["C:/project/a"]);
    expect(
      watchEventPaths({ paths: ["C:/project/a"], sessionId: 8 }, remote),
    ).toEqual([]);
  });

  it("maps native WSL UNC events back to POSIX workspace paths", () => {
    expect(
      normalizeWorkspaceEventPath(
        "//wsl$/Ubuntu/home/serge/project/file.ts",
        wsl,
      ),
    ).toBe("/home/serge/project/file.ts");
    expect(normalizeWorkspaceEventPath("C:/project/file.ts", wsl)).toBe(
      "C:/project/file.ts",
    );
  });

  it("watches a whole tree only for local workspaces", () => {
    watchAddTree("C:/project", { kind: "local" });
    watchRemoveTree("C:/project", { kind: "local" });

    expect(invoke).toHaveBeenNthCalledWith(1, "fs_watch_add_tree", {
      root: "C:/project",
      workspace: { kind: "local" },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "fs_watch_remove_tree", {
      root: "C:/project",
      workspace: { kind: "local" },
    });
  });

  it("routes remote tree watches through their helper session", () => {
    watchAddTree("/srv/app", remote);
    watchRemoveTree("/srv/app", remote);

    expect(invoke).toHaveBeenNthCalledWith(1, "remote_watch_add_tree", {
      root: "/srv/app",
      sessionId: 7,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "remote_watch_remove_tree", {
      root: "/srv/app",
      sessionId: 7,
    });
  });

  it("does not watch a tree for UNC roots", () => {
    watchAddTree("//server/share/project", { kind: "local" });

    expect(invoke).not.toHaveBeenCalled();
  });

  it("matches the tree root and anything under it, case-insensitively", () => {
    expect(isPathWithinTree("C:/project", "C:/project")).toBe(true);
    expect(isPathWithinTree("C:/project/src/a.ts", "C:/project")).toBe(true);
    expect(isPathWithinTree("C:/PROJECT/src/a.ts", "c:/project")).toBe(true);
    expect(isPathWithinTree("C:\\project\\src\\a.ts", "C:/project")).toBe(true);
    expect(isPathWithinTree("C:/projectx/a.ts", "C:/project")).toBe(false);
    expect(isPathWithinTree("C:/other/a.ts", "C:/project")).toBe(false);
  });

  it.each([{ kind: "local" } as WorkspaceEnv, wsl, remote])(
    "never passes an unresolved project namespace to a watcher: %j",
    (workspace) => {
      const path = "remote://voktty-ssh-other/srv/project";
      const slashed = "remote:\\\\voktty-ssh-other\\srv\\project";
      watchAdd([path, slashed], workspace);
      watchRemove([path, slashed], workspace);
      watchAddTree(path, workspace);
      watchRemoveTree(path, workspace);
      watchAddTree(slashed, workspace);
      watchRemoveTree(slashed, workspace);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ kind: "local" } as WorkspaceEnv, "C:/project", "fs_watch"],
    [wsl, "/home/fixture/project", "fs_watch"],
    [remote, "/srv/app", "remote_watch"],
  ] as const)(
    "keeps supported siblings in a mixed watch request",
    (workspace, path, command) => {
      const namespace = "remote://voktty-ssh-other/srv/project";
      watchAdd([namespace, path], workspace);
      watchRemove([namespace, path], workspace);
      const context =
        workspace.kind === "ssh" ? { sessionId: 7 } : { workspace };
      expect(invoke).toHaveBeenNthCalledWith(1, `${command}_add`, {
        paths: [path],
        ...context,
      });
      expect(invoke).toHaveBeenNthCalledWith(2, `${command}_remove`, {
        paths: [path],
        ...context,
      });
    },
  );
});
