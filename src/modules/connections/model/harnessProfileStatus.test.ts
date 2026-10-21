import { describe, expect, it } from "vitest";
import type { HarnessProjectEnvironmentEntry } from "@/modules/harness/lib/harnessEnvStore";
import type { RemoteSessionSnapshot } from "@/modules/remote/sessionPool";
import { harnessProfileStatus } from "./harnessProfileStatus";

const profile = { id: "p1", name: "Host", host: "host.test", user: "dev" };
const project: HarnessProjectEnvironmentEntry = {
  identity: {
    projectId: "remote://voktty-ssh-p1/srv/app",
    profileId: "p1",
    requestedRoot: ".",
    resolvedRoot: "/srv/app",
    automatic: true,
  },
  env: { kind: "ssh", connection: profile, root: "/srv/app", sessionId: 3 },
  connecting: false,
  error: null,
};
const live: RemoteSessionSnapshot = {
  key: { profileId: "p1", root: "." },
  sessionId: 3,
  leases: 1,
  state: { phase: "ready", attempt: 1, error: null },
};

function status(entry = project, pool = [live], target = profile) {
  return harnessProfileStatus(target, { owner: entry }, pool);
}

describe("Harness profile presentation", () => {
  it("reports owned requested-root aliases and explicit opaque owners as ready", () => {
    expect(status().phase).toBe("ready");
    expect(
      status({
        ...project,
        identity: {
          ...project.identity,
          projectId: "opaque",
          automatic: false,
        },
      }).phase,
    ).toBe("ready");
    expect(harnessProfileStatus(profile, {}, [live]).phase).toBe("none");
  });

  it("uses exact profile IDs, never matching host or name", () => {
    expect(status(project, [live], { ...profile, id: "p2" }).phase).toBe(
      "none",
    );
    expect(
      status({ ...project, identity: { ...project.identity, profileId: "p2" } })
        .phase,
    ).toBe("none");
    expect(
      status({
        ...project,
        env: {
          ...project.env,
          kind: "ssh",
          connection: { ...profile, id: "p2" },
          root: "/srv/app",
        },
      }).phase,
    ).toBe("none");
  });

  it.each([
    "host",
    "user",
    "port",
    "identityFile",
    "extraArgs",
    "initialDirectory",
  ] as const)("rejects a changed saved %s binding", (field) => {
    const changed = {
      ...profile,
      [field]: field === "port" ? 2222 : "changed",
    };
    expect(status(project, [live], changed).phase).toBe("none");
  });

  it("normalizes equivalent bindings but does not case-fold native identity", () => {
    expect(
      status(project, [live], {
        ...profile,
        host: " host.test ",
        user: " dev ",
        port: 22,
      } as typeof profile).phase,
    ).toBe("ready");
    expect(
      status(project, [live], { ...profile, host: "HOST.TEST" }).phase,
    ).toBe("none");
  });

  it.each([
    [],
    [{ ...live, sessionId: 4 }],
    [{ ...live, key: { profileId: "p2", root: "." } }],
    [{ ...live, key: { profileId: "p1", root: "/srv/app" } }],
    [{ ...live, leases: 0 }],
    [{ ...live, state: { ...live.state, phase: "disconnected" as const } }],
  ])("requires matching live pool membership %#", (...entries) => {
    expect(status(project, entries).phase).toBe("none");
  });

  it("requires the confirmed actual root and a native session ID", () => {
    expect(
      status({
        ...project,
        identity: { ...project.identity, resolvedRoot: "/elsewhere" },
      }).phase,
    ).toBe("none");
    expect(
      status({
        ...project,
        env: { kind: "ssh", connection: profile, root: "/srv/app" },
      }).phase,
    ).toBe("none");
  });

  it("canonicalizes Windows root separators without folding path case", () => {
    const windows = {
      ...project,
      identity: { ...project.identity, resolvedRoot: "C:/Work/App" },
      env: {
        kind: "ssh" as const,
        connection: profile,
        root: "C:\\Work\\App\\",
        sessionId: 3,
      },
    };
    expect(status(windows).phase).toBe("ready");
    expect(
      status({ ...windows, env: { ...windows.env, root: "C:/work/app" } })
        .phase,
    ).toBe("none");
  });

  it("scopes connecting and errors to their owner identity", () => {
    const pending = {
      ...project,
      env: { kind: "local" as const },
      connecting: true,
    };
    const failed = { ...pending, connecting: false, error: "Denied" };
    expect(status(pending)).toEqual({ phase: "connecting", error: null });
    expect(status(failed)).toEqual({ phase: "error", error: "Denied" });
    expect(status(failed, [live], { ...profile, id: "p2" })).toEqual({
      phase: "none",
      error: null,
    });
  });

  it("prioritizes ready then connecting over failures across multiple roots", () => {
    const pending = {
      ...project,
      env: { kind: "local" as const },
      connecting: true,
    };
    const failed = { ...pending, connecting: false, error: "Denied" };
    for (const projects of [
      { ready: project, pending, failed },
      { failed, pending, ready: project },
    ])
      expect(harnessProfileStatus(profile, projects, [live]).phase).toBe(
        "ready",
      );
    expect(harnessProfileStatus(profile, { failed, pending }, []).phase).toBe(
      "connecting",
    );
    expect(harnessProfileStatus(profile, { pending, failed }, []).phase).toBe(
      "connecting",
    );
  });
});
