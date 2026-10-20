import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  closeProfile: vi.fn(),
  env: { kind: "local" } as
    | { kind: "local" }
    | { kind: "ssh"; connection: { id: string } },
}));

vi.mock("@/modules/harness/lib/harnessEnvStore", () => ({
  useHarnessEnvStore: {
    getState: () => ({
      env: mocks.env,
      connect: mocks.connect,
      disconnect: mocks.disconnect,
    }),
  },
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { closeProfile: mocks.closeProfile },
}));

import type { SshConnection } from "@/modules/ssh/types";
import {
  closeSshProfileSessions,
  harnessProjectPath,
  isProfileConnected,
  OPEN_HARNESS_EVENT,
  openSshProfileInHarness,
  otherSurface,
  profileLinks,
  sshRowActions,
  surfaceOf,
} from "./sshConnectionActions";
import { remoteProjectForPath } from "./remoteProjects";
import { remoteSshEnvironmentId } from "./remoteSshProfiles";

const storage = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
    configurable: true,
    writable: true,
  });
}
const dispatched: Event[] = [];
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: (event: Event) => {
    dispatched.push(event);
    return true;
  },
} as unknown as Window & typeof globalThis;

const profile: SshConnection = { id: "p1", name: "prod", host: "example.test" };
const local = { kind: "local" } as const;

beforeEach(() => {
  localStorage.clear();
  dispatched.length = 0;
  mocks.connect.mockReset();
  mocks.disconnect.mockReset().mockResolvedValue(undefined);
  mocks.closeProfile.mockReset().mockResolvedValue(undefined);
  mocks.env = { kind: "local" };
});

describe("surfaces", () => {
  it("defaults to the terminal and only the explicit value selects the Harness", () => {
    expect(surfaceOf({})).toBe("terminal");
    expect(surfaceOf({ defaultSurface: "harness" })).toBe("harness");
    expect(otherSurface("terminal")).toBe("harness");
    expect(otherSurface("harness")).toBe("terminal");
  });
});

describe("profile links and row actions", () => {
  const pool = [
    { key: { profileId: "p1", root: "/a" }, sessionId: 4, leases: 0, state: {} },
    { key: { profileId: "p2", root: "/b" }, sessionId: undefined, leases: 1, state: {} },
  ] as never;

  it("matches a profile only by exact id on every source", () => {
    const sshEnv = {
      kind: "ssh",
      connection: { ...profile, id: "p1" },
      root: "/",
    } as never;
    expect(
      profileLinks("p1", { workspaceEnv: sshEnv, harnessEnv: local, pool: [] }),
    ).toEqual({ workspace: true, harness: false, pooledSessions: 0 });
    expect(
      profileLinks("p1", {
        workspaceEnv: local,
        harnessEnv: { kind: "ssh", connection: { id: "p1" } },
        pool,
      }),
    ).toEqual({ workspace: false, harness: true, pooledSessions: 1 });
    expect(
      profileLinks("p2", { workspaceEnv: local, harnessEnv: local, pool }),
    ).toEqual({ workspace: false, harness: false, pooledSessions: 0 });
  });

  it("offers Disconnect only while something is connected", () => {
    const idle = { workspace: false, harness: false, pooledSessions: 0 };
    expect(sshRowActions(idle)).toEqual(["open-terminal", "open-harness"]);
    for (const links of [
      { ...idle, workspace: true },
      { ...idle, harness: true },
      { ...idle, pooledSessions: 2 },
    ]) {
      expect(isProfileConnected(links)).toBe(true);
      expect(sshRowActions(links)).toEqual([
        "open-terminal",
        "open-harness",
        "disconnect",
      ]);
    }
  });
});

describe("openSshProfileInHarness", () => {
  it("connects, registers the project root and asks the app to show it", async () => {
    mocks.connect.mockResolvedValue({
      kind: "ssh",
      connection: profile,
      root: "/home/dev",
      sessionId: 3,
    });
    const path = await openSshProfileInHarness(profile);
    expect(path).toBe(harnessProjectPath("p1", "/home/dev"));
    expect(remoteProjectForPath(path)).toMatchObject({
      environmentId: remoteSshEnvironmentId("p1"),
      cwd: "/home/dev",
    });
    const opened = dispatched.filter((e) => e.type === OPEN_HARNESS_EVENT);
    expect(opened).toHaveLength(1);
    expect((opened[0] as CustomEvent).detail).toEqual({ path });
  });

  it("does not open the Harness when the connection fails", async () => {
    mocks.connect.mockRejectedValue(new Error("auth failed"));
    await expect(openSshProfileInHarness(profile)).rejects.toThrow(
      "auth failed",
    );
    expect(dispatched.filter((e) => e.type === OPEN_HARNESS_EVENT)).toHaveLength(0);
  });
});

describe("closeSshProfileSessions", () => {
  it("disconnects the Harness when it holds the profile and always closes pooled sessions", async () => {
    mocks.env = { kind: "ssh", connection: { id: "p1" } };
    await closeSshProfileSessions("p1");
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.closeProfile).toHaveBeenCalledWith("p1");
  });

  it("leaves a Harness connected to another profile alone", async () => {
    mocks.env = { kind: "ssh", connection: { id: "other" } };
    await closeSshProfileSessions("p1");
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.closeProfile).toHaveBeenCalledWith("p1");
  });
});
