import type { WorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNetworkFilesystemPath,
  matchesWatchEvent,
  normalizeWorkspaceEventPath,
  watchAdd,
  watchRemove,
} from "./watch";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
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
});
