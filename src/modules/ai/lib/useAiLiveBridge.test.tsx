// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error react act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import type { Live } from "../store/chatStore";
import { useAiLiveBridge } from "./useAiLiveBridge";
import type { Tab } from "@/modules/tabs";

describe("useAiLiveBridge", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let liveCapture: Live | null = null;

  beforeEach(() => {
    liveCapture = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    container?.remove();
    container = null;
  });

  function renderBridge(props: {
    activeId: number;
    tabs: Tab[];
    explorerRoot?: string | null;
    launchCwd?: string | null;
    home?: string | null;
  }) {
    function BridgeHost() {
      useAiLiveBridge({
        setLive: (live) => {
          liveCapture = live;
        },
        activeId: props.activeId,
        tabs: props.tabs,
        explorerRoot: props.explorerRoot ?? null,
        launchCwd: props.launchCwd ?? null,
        home: props.home ?? null,
        openPreviewTab: vi.fn(),
        newAgentTab: vi.fn(),
        terminalRefs: { current: new Map() },
        editorRefs: { current: new Map() },
      });
      return null;
    }

    act(() => {
      root?.render(createElement(BridgeHost));
    });
  }

  it("returns active tab cwd for local terminals", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        title: "Terminal",
        kind: "terminal",
        cwd: "C:\\proyectos\\local-app",
        workspaceEnv: { kind: "local" },
        paneTree: { kind: "leaf", leafId: 1, cwd: "C:\\proyectos\\local-app" },
        activeLeafId: 1,
      } as unknown as Tab,
    ];

    renderBridge({
      activeId: 1,
      tabs,
      launchCwd: "C:\\proyectos\\launch",
      home: "C:\\Users\\user",
    });

    expect(liveCapture).not.toBeNull();
    expect(liveCapture?.getCwd()).toBe("C:\\proyectos\\local-app");
    expect(liveCapture?.getLocalCwd?.()).toBe("C:\\proyectos\\local-app");
    expect(liveCapture?.getLocalWorkspaceRoot?.()).toBe("C:\\proyectos\\launch");
  });

  it("skips remote SSH tabs for getLocalCwd and falls back to local launchCwd/home", () => {
    const tabs: Tab[] = [
      {
        id: 2,
        title: "SSH Server",
        kind: "terminal",
        cwd: "/workspace/app_projects/webserver",
        workspaceEnv: {
          kind: "ssh",
          connection: { host: "remote.srv", id: "conn1" },
          root: "/workspace",
        },
        paneTree: {
          kind: "leaf",
          leafId: 2,
          cwd: "/workspace/app_projects/webserver",
        },
        activeLeafId: 2,
      } as unknown as Tab,
    ];

    renderBridge({
      activeId: 2,
      tabs,
      explorerRoot: "/workspace/app_projects/webserver",
      launchCwd: "C:\\proyectos\\voktty",
      home: "C:\\Users\\user",
    });

    expect(liveCapture).not.toBeNull();
    // getCwd retains the remote path for terminal features
    expect(liveCapture?.getCwd()).toBe("/workspace/app_projects/webserver");
    // getLocalCwd skips the SSH tab and returns the local launch directory
    expect(liveCapture?.getLocalCwd?.()).toBe("C:\\proyectos\\voktty");
    expect(liveCapture?.getLocalWorkspaceRoot?.()).toBe("C:\\proyectos\\voktty");
  });

  it("skips Docker tabs for getLocalCwd", () => {
    const tabs: Tab[] = [
      {
        id: 3,
        title: "Docker Container",
        kind: "terminal",
        cwd: "/app",
        workspaceEnv: {
          kind: "docker",
          connection: { containerName: "web", id: "c1", image: "node:20" },
        },
        paneTree: { kind: "leaf", leafId: 3, cwd: "/app" },
        activeLeafId: 3,
      } as unknown as Tab,
    ];

    renderBridge({
      activeId: 3,
      tabs,
      home: "C:\\Users\\user",
    });

    expect(liveCapture).not.toBeNull();
    expect(liveCapture?.getCwd()).toBe("/app");
    expect(liveCapture?.getLocalCwd?.()).toBe("C:\\Users\\user");
  });

  it("ignores remote:// explorer roots in getLocalWorkspaceRoot", () => {
    renderBridge({
      activeId: 99,
      tabs: [],
      explorerRoot: "remote://ssh/conn1/root",
      launchCwd: "C:\\proyectos\\app",
      home: "C:\\Users\\user",
    });

    expect(liveCapture?.getLocalWorkspaceRoot?.()).toBe("C:\\proyectos\\app");
  });
});
