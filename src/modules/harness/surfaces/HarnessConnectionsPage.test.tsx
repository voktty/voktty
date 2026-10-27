// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openSettingsWindow: vi.fn(),
  useSshConnections: vi.fn(),
  pool: null as unknown[] | null,
  dialogs: [] as { onOpen: (path: string) => void; onCancel: () => void }[],
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
    onCancel,
  }: {
    initialConnectionId?: string;
    onOpen: (path: string) => void;
    onCancel: () => void;
  }) => {
    mocks.dialogs.push({ onOpen, onCancel });
    return createElement(
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
    );
  },
}));

vi.mock("@/modules/remote/useRemoteSessions", async () => {
  const { remoteSessions } = await import("@/modules/remote/sessionManager");
  return {
    useRemoteSessionSnapshots: () => mocks.pool ?? remoteSessions.snapshot(),
  };
});

import { useHarnessProjectEnvStore } from "@/modules/harness/lib/harnessEnvStore";
import { HarnessConnectionsPage } from "./HarnessConnectionsPage";
import { subscribeHarnessProjectRequests } from "@/modules/surfaces/lib/harnessProjectRequest";
import { HarnessProjectOwner } from "@/modules/harness/hooks/useHarnessProjectSelection";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import * as sshActions from "@/modules/connections/model/sshConnectionActions";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing project selection fixture");
  return value;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.openSettingsWindow.mockReset();
  mocks.pool = null;
  mocks.dialogs = [];
  useHarnessProjectEnvStore.setState({
    projects: {},
  });
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
  vi.restoreAllMocks();
});

async function render(cwd = "~", owner = { ownerId: 1, tabKey: asTabKey("tab-one") }) {
  await act(async () =>
    root.render(createElement(HarnessProjectOwner, { value: owner }, createElement(HarnessConnectionsPage, { cwd }))),
  );
}

describe("Harness connections settings", () => {
  it("does not redirect a delayed connection after its originating view changes", async () => {
    let finish!: (value: { kind: "ssh"; connection: { id: string; name: string; host: string }; root: string; sessionId: number }) => void;
    const connecting = new Promise<Parameters<typeof finish>[0]>((resolve) => { finish = resolve; });
    vi.spyOn(useHarnessProjectEnvStore.getState(), "connect").mockReturnValueOnce(connecting);
    const selected = vi.fn();
    const legacy = vi.fn();
    const release = subscribeHarnessProjectRequests(selected);
    window.addEventListener("voktty:open-harness", legacy);
    try {
      await render();
      await act(async () => required(container.querySelector<HTMLButtonElement>('button[title="Connect"]')).click());
      await render("~", { ownerId: 2, tabKey: asTabKey("tab-two") });
      await act(async () => {
        finish({ kind: "ssh", connection: { id: "profile-1", name: "Build host", host: "build-host" }, root: "/original", sessionId: 4 });
        await connecting;
      });
      expect(selected).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
    } finally {
      release();
      window.removeEventListener("voktty:open-harness", legacy);
    }
  });

  it("retires a cancelled picker without closing or adopting its replacement", async () => {
    const selected = vi.fn();
    const release = subscribeHarnessProjectRequests(selected);
    try {
      await render();
      const open = () => required(container.querySelector<HTMLButtonElement>('button[title="Open folder"]')).click();
      await act(async () => open());
      const original = required(mocks.dialogs[mocks.dialogs.length - 1]);
      await act(async () => original.onCancel());
      await act(async () => open());
      const replacement = required(mocks.dialogs[mocks.dialogs.length - 1]);
      await act(async () => original.onOpen("/late"));
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
      expect(selected).not.toHaveBeenCalled();
      await act(async () => replacement.onOpen("//server/share/project"));
      expect(selected).toHaveBeenCalledExactlyOnceWith({ path: "//server/share/project", target: { ownerId: 1, tabKey: "tab-one" } });
    } finally { release(); }
  });

  it.each(["owner", "project", "unmount"])("rejects a folder result after its %s retires", async (change) => {
    const selected = vi.fn();
    const release = subscribeHarnessProjectRequests(selected);
    try {
      await render();
      await act(async () => required(container.querySelector<HTMLButtonElement>('button[title="Open folder"]')).click());
      const original = required(mocks.dialogs[mocks.dialogs.length - 1]);
      if (change === "owner") await render("~", { ownerId: 2, tabKey: asTabKey("tab-two") });
      else if (change === "project") await render("/other");
      else await act(async () => root.render(null));
      await act(async () => original.onOpen("/late"));
      expect(selected).not.toHaveBeenCalled();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally { release(); }
  });

  it.each(["Disconnect", "Reconnect"])("retires delayed %s navigation before a successor view can receive it", async (action) => {
    let finish!: () => void;
    const closing = new Promise<void>((resolve) => { finish = resolve; });
    const close = vi.spyOn(sshActions, "closeSshProfileSessions").mockReturnValueOnce(closing);
    const connect = vi.spyOn(sshActions, "openSshProfileInHarness");
    await useHarnessProjectEnvStore.getState().connect({ id: "profile-1", name: "Build host", user: "dev", host: "build-host" });
    const selected = vi.fn();
    const release = subscribeHarnessProjectRequests(selected);
    try {
      await render();
      await act(async () => required(container.querySelector<HTMLButtonElement>(`button[title="${action}"]`)).click());
      expect(close).toHaveBeenCalledExactlyOnceWith("profile-1");
      await render("~", { ownerId: 2, tabKey: asTabKey("tab-two") });
      await act(async () => { finish(); await closing; });
      expect(selected).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      finish();
      release();
      await act(async () => useHarnessProjectEnvStore.getState().disconnectAll());
    }
  });
  it("delivers a folder selection through the typed channel without broadcasting a DOM event", async () => {
    const selected = vi.fn();
    const legacy = vi.fn();
    const release = subscribeHarnessProjectRequests(selected);
    window.addEventListener("voktty:harness-select-project", legacy);
    try {
      await render();
      await act(async () => required(container.querySelector<HTMLButtonElement>('button[title="Open folder"]')).click());
      await act(async () => required(container.querySelector<HTMLButtonElement>('[role="dialog"] button')).click());
      expect(selected).toHaveBeenCalledExactlyOnceWith({ path: "remote://voktty-ssh-profile-1/srv/app", target: { ownerId: 1, tabKey: "tab-one" } });
      expect(legacy).not.toHaveBeenCalled();
    } finally {
      release();
      window.removeEventListener("voktty:harness-select-project", legacy);
    }
  });
  it("keeps each view's current project independent across other project updates", async () => {
    const profiles = ["one", "two"].map((id) => ({
      id,
      name: `Host ${id}`,
      host: `${id}.test`,
    }));
    const paths = [
      "remote://legacy-one/srv/app",
      "remote://legacy-two/srv/app",
    ];
    mocks.useSshConnections.mockReturnValue(profiles);
    useHarnessProjectEnvStore.setState({
      projects: Object.fromEntries(
        profiles.map((profile, index) => [
          `alias-${profile.id}`,
          {
            identity: {
              projectId: paths[index],
              profileId: profile.id,
              requestedRoot: ".",
              resolvedRoot: "/srv/app",
              automatic: true,
            },
            env: { kind: "local" as const },
            connecting: true,
            error: null,
          },
        ]),
      ),
    });
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          ...paths.map((cwd, index) =>
            createElement(
              "div",
              { key: cwd, "data-view": index },
              createElement(HarnessConnectionsPage, { cwd }),
            ),
          ),
        ),
      ),
    );
    const current = (index: number) =>
      Array.from(
        container.querySelectorAll(
          `[data-view='${index}'] section > div.divide-y > div`,
        ),
      ).find((row) =>
        row.textContent?.includes("harness.connections.currentProject"),
      )?.textContent;
    expect(current(0)).toContain("Host one");
    expect(current(1)).toContain("Host two");
    await act(async () =>
      useHarnessProjectEnvStore.setState((state) => ({
        projects: {
          ...state.projects,
          "alias-two": {
            ...state.projects["alias-two"],
            connecting: false,
            error: "Connection failed",
          },
        },
      })),
    );
    expect(current(0)).toContain("Host one");
    expect(current(1)).toContain("Host two");
  });

  it("does not borrow a connected project's badge for a local settings view", async () => {
    await useHarnessProjectEnvStore
      .getState()
      .connect(
        { id: "profile-1", name: "Build host", host: "build-host" },
        "/srv/other",
      );
    await render("/srv/local");
    expect(container.textContent).not.toContain(
      "harness.connections.currentProject",
    );
  });

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
    const release = subscribeHarnessProjectRequests(selected);
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
      expect(selected.mock.calls[0][0]).toEqual({ path: "remote://voktty-ssh-profile-1/srv/app", target: { ownerId: 1, tabKey: "tab-one" } });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      release();
    }
  });

  it("selects remote project in Harness when Connect is clicked", async () => {
    const onSelectProject = vi.fn();
    const release = subscribeHarnessProjectRequests(onSelectProject);
    try {
      await render();
      const connectBtn = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Connect"),
      );
      if (!connectBtn) throw new Error("Missing connect button");

      await act(async () => connectBtn.click());

      expect(onSelectProject).toHaveBeenCalledOnce();
      expect(onSelectProject.mock.calls[0][0]).toEqual({ path: "remote://voktty-ssh-profile-1/home/dev", target: { ownerId: 1, tabKey: "tab-one" } });
    } finally {
      release();
    }
  });

  it("keeps concurrent profiles independent of global selection and same-host duplicates", async () => {
    const profiles = ["ready", "pending", "failed", "same-host"].map((id) => ({
      id,
      name: id,
      host: "host.test",
    }));
    mocks.useSshConnections.mockReturnValue(profiles);
    const identity = (id: string) => ({
      projectId: `remote://voktty-ssh-${id}/srv/app`,
      profileId: id,
      requestedRoot: ".",
      resolvedRoot: "/srv/app",
      automatic: true,
    });
    useHarnessProjectEnvStore.setState({
      projects: {
        unrelated: {
          identity: identity("unrelated"),
          env: { kind: "local" },
          connecting: false,
          error: "Unrelated global failure",
        },
        ready: {
          identity: identity("ready"),
          env: {
            kind: "ssh",
            connection: profiles[0],
            root: "/srv/app",
            sessionId: 9,
          },
          connecting: false,
          error: null,
        },
        pending: {
          identity: identity("pending"),
          env: { kind: "local" },
          connecting: true,
          error: null,
        },
        failed: {
          identity: identity("failed"),
          env: { kind: "local" },
          connecting: false,
          error: "Owner denied",
        },
      },
    });
    mocks.pool = [
      {
        key: { profileId: "ready", root: "." },
        sessionId: 9,
        leases: 1,
        state: { phase: "ready" },
      },
    ];
    await render();
    const rows = container.querySelectorAll("section > div.divide-y > div");
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain("Connected");
    expect(rows[0].textContent).toContain("Disconnect");
    expect(rows[1].textContent).toContain("Connecting...");
    expect(
      rows[1].querySelector<HTMLButtonElement>('button[title="Connect"]')
        ?.disabled,
    ).toBe(true);
    expect(rows[2].textContent).toContain("Owner denied");
    expect(rows[3].textContent).not.toContain("Connected");
    expect(rows[3].textContent).not.toContain("Connecting...");
    expect(rows[3].textContent).not.toContain("Error");
    expect(container.textContent).not.toContain("Unrelated global failure");
  });

  it("does not report a saved profile whose live native binding changed as connected", async () => {
    const saved = { id: "profile-1", name: "Build host", host: "new.test" };
    mocks.useSshConnections.mockReturnValue([saved]);
    useHarnessProjectEnvStore.setState({
      projects: {
        owner: {
          identity: {
            projectId: "opaque",
            profileId: saved.id,
            requestedRoot: ".",
            resolvedRoot: "/srv/app",
            automatic: false,
          },
          env: {
            kind: "ssh",
            connection: { ...saved, host: "old.test" },
            root: "/srv/app",
            sessionId: 9,
          },
          connecting: false,
          error: null,
        },
      },
    });
    mocks.pool = [
      {
        key: { profileId: saved.id, root: "." },
        sessionId: 9,
        leases: 1,
        state: { phase: "ready" },
      },
    ];
    await render();
    expect(container.textContent).not.toContain("Disconnect");
    expect(container.textContent).not.toContain("Connected");
  });

  it("shows Disconnect and Reconnect when profile is connected", async () => {
    const { useHarnessProjectEnvStore } = await import(
      "../lib/harnessEnvStore"
    );
    const connection = {
      id: "profile-1",
      name: "Build host",
      user: "dev",
      host: "build-host",
    };
    await useHarnessProjectEnvStore.getState().connect(connection);

    const onSelectProject = vi.fn();
    const release = subscribeHarnessProjectRequests(onSelectProject);
    try {
      await render();
      const disconnectBtn = Array.from(
        container.querySelectorAll("button"),
      ).find((button) => button.textContent?.includes("Disconnect"));
      if (!disconnectBtn) throw new Error("Missing disconnect button");

      await act(async () => disconnectBtn.click());
      expect(onSelectProject).toHaveBeenCalledOnce();
      expect(onSelectProject.mock.calls[0][0]).toEqual({ path: "~", target: { ownerId: 1, tabKey: "tab-one" } });
    } finally {
      release();
      await act(async () =>
        useHarnessProjectEnvStore.getState().disconnectAll(),
      );
    }
  });
});
