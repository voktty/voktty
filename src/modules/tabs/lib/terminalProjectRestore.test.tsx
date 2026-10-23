// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTabs } from "@/modules/tabs/lib/useTabs";
import {
  terminalRestoreWorkspace,
  terminalRestorePath,
  terminalRestoreProject,
} from "@/modules/tabs/lib/terminalProjectRestore";
import { hydrateTabs, serializeTabs } from "@/modules/spaces/lib/serialize";

vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  disposeSession: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

it.each(["/srv/app", "C:/Work/App", "//server/share/app"])(
  "round-trips host path %s without changing its filesystem",
  (path) => {
    const uri = terminalRestorePath("remote://voktty-ssh-build/srv/app", path);
    expect(terminalRestoreProject(uri)?.hostPath).toBe(path);
  },
);

it("retains the original project after canonical SSH resolution, duplication and warming", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const project = "remote://voktty-ssh-build/srv/app";
  let id = 100;
  const [original] = hydrateTabs(
    [
      {
        kind: "terminal",
        remoteProject: project,
        tree: { kind: "leaf", cwd: "/srv/app/src" },
      },
    ],
    "main",
    () => id++,
  );
  let tabs: ReturnType<typeof useTabs> | undefined;
  function Host() {
    tabs = useTabs();
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Host />));
    if (!tabs || original.kind !== "terminal") throw new Error("Missing tabs.");
    await act(async () => {
      tabs?.replaceTabs([original], original.id);
      tabs?.markBooted();
    });
    expect(tabs.getTab(original.id)?.cold).toBe(false);
    const resolved = {
      ...terminalRestoreWorkspace(project),
      root: "/canonical/app",
      sessionId: 71,
      connection: { id: "build", name: "Build", host: "build.example" },
    };
    await act(async () =>
      tabs?.updateTab(original.id, { workspaceEnv: resolved }),
    );
    expect(tabs.getTab(original.id)).toMatchObject({
      projectCwd: project,
      workspaceEnv: resolved,
    });
    let duplicate: number | null = null;
    await act(async () => {
      duplicate = tabs?.duplicateTab(original.id) ?? null;
    });
    if (duplicate === null) throw new Error("Missing duplicate.");
    expect(tabs.getTab(duplicate)).toMatchObject({
      projectCwd: project,
      workspaceEnv: resolved,
    });
    expect(serializeTabs(tabs.getTabs())).toHaveLength(2);
    await act(async () =>
      tabs?.updateTab(original.id, {
        workspaceEnv: { ...resolved, root: "/another/project" },
      }),
    );
    const moved = tabs.getTab(original.id);
    expect(moved).toHaveProperty("projectCwd", undefined);
    expect(moved).toHaveProperty("workspaceEnv.restoredProjectCwd", undefined);
    if (!moved) throw new Error("Missing moved terminal.");
    expect(serializeTabs([moved])).toEqual([]);
    await act(async () =>
      tabs?.updateTab(original.id, { workspaceEnv: { kind: "local" } }),
    );
    expect(tabs.getTab(original.id)).toHaveProperty("projectCwd", undefined);
    expect(tabs.getTab(duplicate)).toHaveProperty("projectCwd", project);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
