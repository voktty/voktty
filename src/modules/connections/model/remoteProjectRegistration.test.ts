import { beforeEach, describe, expect, it } from "vitest";
import {
  registerSshProjectPath,
  sshProjectId,
} from "./remoteProjectRegistration";
import { remotePath, remoteProjectForPath } from "./remoteProjects";
import { remoteSshEnvironmentId } from "./remoteSshProfiles";

const profiles = [{ id: "ssh-1", name: "prod" }];
const env = remoteSshEnvironmentId("ssh-1");

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
if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  } as unknown as Window & typeof globalThis;
}

beforeEach(() => {
  localStorage.clear();
});

describe("registerSshProjectPath", () => {
  it("registers an unknown folder of a saved profile so file commands accept it", () => {
    const path = remotePath(env, "/srv/app");
    expect(remoteProjectForPath(path)).toBeUndefined();
    const project = registerSshProjectPath(path, profiles);
    expect(project).toMatchObject({
      environmentId: env,
      cwd: "/srv/app",
      projectId: sshProjectId("ssh-1", "/srv/app"),
    });
    expect(remoteProjectForPath(remotePath(env, "/srv/app/src/a.ts"))).toEqual(
      project,
    );
  });

  it("is idempotent and reuses the owning project for nested folders", () => {
    const root = registerSshProjectPath(remotePath(env, "/srv/app"), profiles);
    const nested = registerSshProjectPath(
      remotePath(env, "/srv/app/packages/x"),
      profiles,
    );
    expect(nested).toEqual(root);
  });

  it("refuses profiles that are not saved, even if host or name look similar", () => {
    const stranger = remotePath(remoteSshEnvironmentId("ssh-9"), "/srv/app");
    expect(registerSshProjectPath(stranger, profiles)).toBeUndefined();
    expect(remoteProjectForPath(stranger)).toBeUndefined();
  });

  it("ignores local paths and legacy machine identities", () => {
    expect(registerSshProjectPath("/home/me/app", profiles)).toBeUndefined();
    expect(
      registerSshProjectPath(remotePath("machine-1", "/srv/app"), profiles),
    ).toBeUndefined();
  });
});
