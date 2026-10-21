// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessProjectEnvironmentEntry } from "@/modules/harness/lib/harnessEnvStore";
import type { RemoteSessionSnapshot } from "@/modules/remote/sessionPool";

const mocks = vi.hoisted(() => ({
  projects: {} as Record<string, HarnessProjectEnvironmentEntry>,
  pool: [] as RemoteSessionSnapshot[],
  profiles: ["a", "b", "duplicate"].map((id) => ({
    id,
    name: id,
    host: "host.test",
  })),
}));
vi.mock("@/lib/platform", () => ({ IS_WINDOWS: false }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/modules/rdp", () => ({ useRdpConnections: () => [] }));
vi.mock("@/modules/harness/lib/harnessEnvStore", () => ({
  useHarnessProjectEnvStore: (select: (state: unknown) => unknown) =>
    select({ projects: mocks.projects }),
}));
vi.mock("@/modules/remote/useRemoteSessions", () => ({
  useRemoteSessionSnapshots: () => mocks.pool,
}));
vi.mock("@/modules/ssh", () => ({
  useSshConnections: () => mocks.profiles,
  useSshPing: () => ({ pingMap: {}, refreshPings: vi.fn() }),
  formatSshSubtitle: () => "host.test",
  updateSshConnection: vi.fn(),
  SshMetricsHoverCard: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/ui/dropdown-menu", () => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement("div", null, children);
  return {
    DropdownMenu: wrapper,
    DropdownMenuContent: wrapper,
    DropdownMenuTrigger: wrapper,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: wrapper,
  };
});
vi.mock(
  "@/modules/connections/model/sshConnectionActions",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@/modules/connections/model/sshConnectionActions")
      >();
    return { ...original, openSshProfileInHarness: vi.fn() };
  },
);

import { useWorkspaceEnvStore } from "@/modules/workspace";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.projects = {};
  mocks.pool = [];
  useWorkspaceEnvStore.setState({
    env: { kind: "local" },
    connectionAttempts: {},
  });
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
  await act(async () =>
    root.render(createElement(WorkspaceEnvSelector, { onSelect: vi.fn() })),
  );
}
function ready(id: string, sessionId: number): HarnessProjectEnvironmentEntry {
  return {
    identity: {
      projectId: `opaque-${id}`,
      profileId: id,
      requestedRoot: ".",
      resolvedRoot: "/srv/app",
      automatic: false,
    },
    env: {
      kind: "ssh",
      connection: { id, name: id, host: "host.test" },
      root: "/srv/app",
      sessionId,
    },
    connecting: false,
    error: null,
  };
}

describe("workspace selector Harness reports", () => {
  it("lists both project-owned connected profiles, not a same-host duplicate", async () => {
    mocks.projects = { ownerA: ready("a", 1), ownerB: ready("b", 2) };
    mocks.pool = [1, 2].map((sessionId, index) => ({
      key: { profileId: index ? "b" : "a", root: "." },
      sessionId,
      leases: 1,
      state: { phase: "ready", attempt: 1, error: null },
    }));
    await render();
    const cards = container.querySelectorAll("div.bg-violet-500\\/10");
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("a");
    expect(cards[1].textContent).toContain("b");
    expect(cards[1].textContent).not.toContain("duplicate");
    expect(container.querySelector("button")?.title).toBe(
      "workspace.environment",
    );
    expect(container.querySelector("button")?.textContent).not.toContain("a");
  });

  it("shows an owned failure only on its profile and preserves the terminal trigger", async () => {
    mocks.projects = {
      ownerA: {
        ...ready("a", 1),
        env: { kind: "local" },
        error: "Owner denied",
      },
    };
    await render();
    expect(container.querySelectorAll('[title="Owner denied"]')).toHaveLength(
      2,
    );
    expect(
      container.textContent?.match(/terminal.connection.error/g),
    ).toHaveLength(1);
    expect(container.querySelector("button")?.title).toBe(
      "workspace.environment",
    );
  });
});
