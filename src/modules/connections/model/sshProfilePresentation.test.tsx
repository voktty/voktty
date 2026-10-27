// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
vi.mock("@/modules/remote/client", () => ({
  openRemoteWorkspace: native.open,
  closeRemoteWorkspace: native.close,
}));

import { harnessProfileStatus } from "@/modules/connections/model/harnessProfileStatus";
import {
  closeSshProfileSessions,
  openSshProfileInHarness,
} from "@/modules/connections/model/sshConnectionActions";
import { useHarnessProjectEnvStore } from "@/modules/harness/lib/harnessEnvStore";
import { remoteSessions } from "@/modules/remote/sessionManager";
import { useRemoteSessionSnapshots } from "@/modules/remote/useRemoteSessions";

afterEach(async () => {
  await useHarnessProjectEnvStore.getState().disconnectAll();
  await remoteSessions.closeAll();
  vi.unstubAllGlobals();
});

it("exposes a newly opened Harness profile to the disconnect selector", async () => {
  const profile = {
    id: "smoke-ssh",
    name: "Fixture",
    host: "127.0.0.1",
    user: "dev",
    port: 2222,
    initialDirectory: "/srv/project",
    defaultSurface: "harness" as const,
  };
  native.open.mockResolvedValue({
    session_id: 3,
    workspace_root: "/srv/project",
    architecture: "x86_64",
    helper_version: "1",
    capabilities: [],
  });
  native.close.mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let phase = "none";
  let latest = remoteSessions.snapshot();
  function Reader() {
    const projects = useHarnessProjectEnvStore((state) => state.projects);
    const pool = useRemoteSessionSnapshots();
    latest = pool;
    phase = harnessProfileStatus(profile, projects, pool).phase;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Reader />));
    await act(async () => {
      await openSshProfileInHarness(profile, () => {});
    });
    expect(
      harnessProfileStatus(
        profile,
        useHarnessProjectEnvStore.getState().projects,
        remoteSessions.snapshot(),
      ).phase,
    ).toBe("ready");
    expect(phase).toBe("ready");
    const accepted = latest;
    await act(async () => root.render(<Reader />));
    expect(latest).toBe(accepted);
    await act(async () => {
      await closeSshProfileSessions(profile.id);
    });
    expect(phase).toBe("none");
    expect(latest).toEqual([]);
    expect(native.close).toHaveBeenCalledExactlyOnceWith(3);
    native.open.mockResolvedValue({
      session_id: 4,
      workspace_root: "/srv/project",
      architecture: "x86_64",
      helper_version: "1",
      capabilities: [],
    });
    await act(async () => {
      await openSshProfileInHarness(profile, () => {});
    });
    expect(phase).toBe("ready");
    expect(latest[0].sessionId).toBe(4);
  } finally {
    await act(async () => root.unmount());
  }
});
