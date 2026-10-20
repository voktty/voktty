// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openSettingsWindow: vi.fn(),
  useSshConnections: vi.fn(),
}));

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "harness.connections.addProfile": "Add SSH profile",
        "harness.connections.dialogTitle": "Open folder on a machine",
        "harness.connections.emptyDescription": "Add an SSH profile first.",
        "harness.connections.emptyTitle": "No SSH profiles saved",
        "harness.connections.intro": "Use Voktty's native SSH agent.",
        "harness.connections.manageProfiles": "Manage SSH profiles",
        "harness.connections.openFolder": "Open folder",
        "harness.connections.profilesTitle": "Saved SSH profiles",
        "harness.connections.connect": "Connect",
        "harness.connections.disconnect": "Disconnect",
        "harness.connections.reconnect": "Reconnect",
        "harness.connections.connected": "Connected",
        "harness.connections.connecting": "Connecting...",
        "harness.connections.disconnected": "Disconnected",
        "harness.connections.refreshPings": "Refresh status",
      })[key] ?? key,
  }),
}));

vi.mock("@/modules/ssh", () => ({
  formatSshSubtitle: (connection: { user?: string; host: string }) =>
    `${connection.user ? `${connection.user}@` : ""}${connection.host}`,
  useSshConnections: mocks.useSshConnections,
  useSshPing: () => ({ pingMap: {}, refreshPings: vi.fn() }),
}));

vi.mock("@/modules/settings/openSettingsWindow", () => ({
  openSettingsWindow: mocks.openSettingsWindow,
}));

vi.mock("@/modules/remote/client", () => ({
  openRemoteWorkspace: vi.fn().mockResolvedValue({
    session_id: 1,
    architecture: "x86_64",
    workspace_root: "/home/dev",
    helper_version: "1.0",
    capabilities: [],
  }),
  closeRemoteWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/connections", () => ({
  AddRemoteProjectDialog: ({
    initialConnectionId,
    onOpen,
  }: {
    initialConnectionId?: string;
    onOpen: (path: string) => void;
  }) =>
    createElement(
      "div",
      {
        role: "dialog",
        "aria-label": "Open folder on a machine",
        "data-connection-id": initialConnectionId,
      },
      createElement(
        "button",
        {
          type: "button",
          onClick: () => onOpen("remote://voktty-ssh-profile-1/srv/app"),
        },
        "Choose project",
      ),
    ),
}));

import { HarnessConnectionsPage } from "./HarnessConnectionsPage";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.openSettingsWindow.mockReset();
  mocks.useSshConnections.mockReturnValue([
    { id: "profile-1", name: "Build host", user: "dev", host: "build-host" },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(HarnessConnectionsPage)));
}

describe("Harness connections settings", () => {
  it("opens a remote folder picker for the selected saved SSH profile", async () => {
    await render();
    const open = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Open folder",
    );
    if (!open) throw new Error("Missing remote folder action");

    await act(async () => open.click());

    expect(
      container
        .querySelector('[role="dialog"]')
        ?.getAttribute("data-connection-id"),
    ).toBe("profile-1");
  });

  it("routes profile creation to Voktty SSH settings when none are saved", async () => {
    mocks.useSshConnections.mockReturnValue([]);
    await render();
    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add SSH profile",
    );
    if (!add) throw new Error("Missing SSH profile action");

    await act(async () => add.click());

    expect(mocks.openSettingsWindow).toHaveBeenCalledWith("ssh");
    expect(container.textContent).toContain("Add an SSH profile first.");
  });

  it("returns the selected remote project to Harness", async () => {
    const selected = vi.fn();
    window.addEventListener("voktty:harness-select-project", selected);
    try {
      await render();
      const open = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Open folder",
      );
      if (!open) throw new Error("Missing remote folder action");
      await act(async () => open.click());
      const choose = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Choose project",
      );
      if (!choose) throw new Error("Missing project selection action");

      await act(async () => choose.click());

      expect(selected).toHaveBeenCalledOnce();
      const event = selected.mock.calls[0]?.[0] as CustomEvent<{
        path: string;
      }>;
      expect(event.detail.path).toBe("remote://voktty-ssh-profile-1/srv/app");
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      window.removeEventListener("voktty:harness-select-project", selected);
    }
  });

  it("selects remote project in Harness when Connect is clicked", async () => {
    const onSelectProject = vi.fn();
    window.addEventListener("voktty:open-harness", onSelectProject);
    try {
      await render();
      const connectBtn = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Connect"),
      );
      if (!connectBtn) throw new Error("Missing connect button");

      await act(async () => connectBtn.click());

      expect(onSelectProject).toHaveBeenCalledOnce();
      const event = onSelectProject.mock.calls[0]?.[0] as CustomEvent<{
        path: string;
      }>;
      expect(event.detail.path).toBe("remote://voktty-ssh-profile-1/home/dev");
    } finally {
      window.removeEventListener("voktty:open-harness", onSelectProject);
    }
  });

  it("shows Disconnect and Reconnect when profile is connected", async () => {
    const { useHarnessEnvStore } = await import("../lib/harnessEnvStore");
    const originalEnv = useHarnessEnvStore.getState().env;
    act(() => {
      useHarnessEnvStore.setState({
        env: {
          kind: "ssh",
          connection: { id: "profile-1", name: "Build host", user: "dev", host: "build-host" },
          root: "/home/dev",
          sessionId: 1,
        },
      });
    });

    const onSelectProject = vi.fn();
    window.addEventListener("voktty:harness-select-project", onSelectProject);
    try {
      await render();
      const disconnectBtn = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Disconnect"),
      );
      if (!disconnectBtn) throw new Error("Missing disconnect button");

      await act(async () => disconnectBtn.click());
      expect(onSelectProject).toHaveBeenCalledOnce();
      const event = onSelectProject.mock.calls[0]?.[0] as CustomEvent<{
        path: string;
      }>;
      expect(event.detail.path).toBe("~");
    } finally {
      window.removeEventListener("voktty:harness-select-project", onSelectProject);
      act(() => {
        useHarnessEnvStore.setState({ env: originalEnv });
      });
    }
  });
});
