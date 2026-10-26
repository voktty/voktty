// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
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
import { IS_WINDOWS } from "@/lib/platform";
import { asTabKey, asWorkspaceScopeId } from "@/modules/tabs/lib/tabIdentity";

const LOCAL_APP_PATH = IS_WINDOWS
  ? "C:\\proyectos\\local-app"
  : "/home/user/proyectos/local-app";
const LAUNCH_PATH = IS_WINDOWS
  ? "C:\\proyectos\\launch"
  : "/home/user/proyectos/launch";
const HOME_PATH = IS_WINDOWS ? "C:\\Users\\user" : "/home/user";
const VOKTTY_PATH = IS_WINDOWS
  ? "C:\\proyectos\\voktty"
  : "/home/user/proyectos/voktty";
const APP_PATH = IS_WINDOWS ? "C:\\proyectos\\app" : "/home/user/proyectos/app";

describe("useAiLiveBridge", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let liveCapture: Live | null = null;
  let publications: Live[] = [];

  beforeEach(() => {
    liveCapture = null;
    publications = [];
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
    strict?: boolean;
  }) {
    function BridgeHost() {
      useAiLiveBridge({
        setLive: (live) => {
          liveCapture = live;
          publications.push(live);
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
      root?.render(
        props.strict
          ? createElement(StrictMode, null, createElement(BridgeHost))
          : createElement(BridgeHost),
      );
    });
  }

  it("returns active tab cwd for local terminals", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        title: "Terminal",
        kind: "terminal",
        cwd: LOCAL_APP_PATH,
        workspaceEnv: { kind: "local" },
        paneTree: { kind: "leaf", leafId: 1, cwd: LOCAL_APP_PATH },
        activeLeafId: 1,
      } as unknown as Tab,
    ];

    renderBridge({
      activeId: 1,
      tabs,
      launchCwd: LAUNCH_PATH,
      home: HOME_PATH,
    });

    expect(liveCapture).not.toBeNull();
    expect(liveCapture?.getCwd()).toBe(LOCAL_APP_PATH);
    expect(liveCapture?.getLocalCwd?.()).toBe(LOCAL_APP_PATH);
    expect(liveCapture?.getLocalWorkspaceRoot?.()).toBe(LAUNCH_PATH);
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
      launchCwd: VOKTTY_PATH,
      home: HOME_PATH,
    });

    expect(liveCapture).not.toBeNull();
    // getCwd retains the remote path for terminal features
    expect(liveCapture?.getCwd()).toBe("/workspace/app_projects/webserver");
    // getLocalCwd skips the SSH tab and returns the local launch directory
    expect(liveCapture?.getLocalCwd?.()).toBe(VOKTTY_PATH);
    expect(liveCapture?.getLocalWorkspaceRoot?.()).toBe(VOKTTY_PATH);
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
      home: HOME_PATH,
    });

    expect(liveCapture).not.toBeNull();
    expect(liveCapture?.getCwd()).toBe("/app");
    expect(liveCapture?.getLocalCwd?.()).toBe(HOME_PATH);
  });

  it("ignores remote:// explorer roots in getLocalWorkspaceRoot", () => {
    renderBridge({
      activeId: 99,
      tabs: [],
      explorerRoot: "remote://ssh/conn1/root",
      launchCwd: APP_PATH,
      home: HOME_PATH,
    });

    expect(liveCapture?.getLocalWorkspaceRoot?.()).toBe(APP_PATH);
  });

  it("captures the editor filesystem independently of a hidden terminal and retires on unmount", () => {
    renderBridge({
      activeId: 2,
      tabs: [
        {
          id: 1,
          spaceId: "fixture",
          tabKey: asTabKey("tab-fixture"),
          workspaceScopeId: asWorkspaceScopeId("fixture"),
          title: "Fixture",
          kind: "terminal",
          cwd: "/other",
          paneTree: { kind: "leaf", id: 1, cwd: "/other" },
          activeLeafId: 1,
        },
        {
          id: 2,
          kind: "editor",
          path: "/repo/file.ts",
          workspaceEnv: { kind: "wsl", distro: "fixture" },
        } as Tab,
      ],
      explorerRoot: "/other",
    });
    const captured = liveCapture as
      | (Live & { getFileContext?: () => unknown })
      | null;
    expect(captured?.getFileContext?.()).toEqual({
      directory: "/repo",
      workspace: { kind: "wsl", distro: "fixture" },
    });
    act(() => root?.unmount());
    root = null;
    expect(captured?.getFileContext?.()).toBeNull();
  });

  it("does not revive the discarded StrictMode publication", () => {
    renderBridge({
      strict: true,
      activeId: 1,
      tabs: [{ id: 1, kind: "editor", path: "/repo/file.ts" } as Tab],
    });
    expect(publications).toHaveLength(2);
    expect(publications[0].getFileContext?.()).toBeNull();
    expect(publications[1].getFileContext?.()).toEqual({
      directory: "/repo",
      workspace: { kind: "local" },
    });
  });
});
