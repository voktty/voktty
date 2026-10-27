import { beforeEach, expect, it } from "vitest";
import {
  forgetRemoteProject,
  relativeWithinProject,
  rememberRemoteProject,
  remotePath,
  remoteProjectFor,
  remoteProjectForPath,
  terminalProjectPath,
} from "./remoteProjects";

const storage = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      get length() {
        return storage.size;
      },
      key: (i: number) => Array.from(storage.keys())[i] ?? null,
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

it.each(["/", "C:/", "//server/share"])(
  "finds and forgets a saved remote root %s",
  (cwd) => {
    const project = rememberRemoteProject("env", {
      id: "root",
      cwd,
      name: "Root",
    });
    const path = remotePath("env", cwd);
    expect(remoteProjectFor(path)).toEqual(project);
    expect(remoteProjectFor(remotePath("other", cwd))).toBeUndefined();
    expect(
      remoteProjectFor(remotePath("env", `${cwd.replace(/\/$/, "")}/child`)),
    ).toBeUndefined();
    forgetRemoteProject(path);
    expect(remoteProjectFor(path)).toBeUndefined();
  },
);

it("finds a saved UNC project through its corrected remote path", () => {
  const legacyKey = "remote://env/server/share/repo";
  const project = {
    key: legacyKey,
    environmentId: "env",
    projectId: "project",
    cwd: "\\\\server\\share\\repo",
  };
  localStorage.setItem(
    "terax.remote-projects.v2",
    JSON.stringify({ [legacyKey]: project }),
  );
  expect(remoteProjectFor(remotePath("env", project.cwd))).toEqual(project);
  localStorage.removeItem("terax.remote-projects.v2");
});

it("finds the most specific saved project that contains a remote path", () => {
  const parent = {
    key: remotePath("env", "/srv/projects"),
    environmentId: "env",
    projectId: "parent",
    cwd: "/srv/projects",
  };
  const nested = {
    key: remotePath("env", "/srv/projects/app"),
    environmentId: "env",
    projectId: "nested",
    cwd: "/srv/projects/app",
  };
  localStorage.setItem(
    "terax.remote-projects.v2",
    JSON.stringify({ [parent.key]: parent, [nested.key]: nested }),
  );

  expect(
    remoteProjectForPath(remotePath("env", "/srv/projects/app/src/a.ts")),
  ).toEqual(nested);
  expect(
    remoteProjectForPath(remotePath("env", "/srv/projects-other/a.ts")),
  ).toBe(undefined);
  expect(
    remoteProjectForPath(remotePath("env", "/srv/projects/../secret")),
  ).toBe(undefined);
});

it("keeps OSC terminal working directories in the remote path namespace", () => {
  expect(
    terminalProjectPath("remote://machine-1/srv/app", "/srv/app/src"),
  ).toBe("remote://machine-1/srv/app/src");
  expect(terminalProjectPath("/local/app", "/local/app/src")).toBe(
    "/local/app/src",
  );
});

it("removes remote projects with forgetRemoteProject", () => {
  const project = rememberRemoteProject("env-1", {
    id: "proj-1",
    cwd: "/var/www/app",
    name: "app",
  });
  expect(remoteProjectFor(project.key)).toBeDefined();

  forgetRemoteProject(project.key);
  expect(remoteProjectFor(project.key)).toBeUndefined();
});

it("expresses a folder relative to its project root", () => {
  expect(relativeWithinProject("/config", "/config")).toBe(".");
  expect(relativeWithinProject("/config/", "/config/workspace/ahorrio")).toBe(
    "workspace/ahorrio",
  );
  expect(relativeWithinProject("/", "/srv/app")).toBe("srv/app");
  expect(relativeWithinProject("/config", "/config-other/x")).toBeUndefined();
  expect(relativeWithinProject("/config", "/config/../etc")).toBeUndefined();
});

it.each([
  ["/config", "/config/a//b", "a/b"],
  ["/config", "/config/a/./b", "a/b"],
  ["/config", "/config/a/../b", "b"],
  ["C:\\Config", "c:\\config\\Source\\file.ts", "Source/file.ts"],
  ["\\\\Host\\Share\\Config", "//HOST/share/config/Src/FILE.ts", "Src/FILE.ts"],
  ["C:/Config", "c:/CONFIG/Src/İİFILE.ts", "Src/İİFILE.ts"],
])(
  "preserves the normalized relative destination for %s and %s",
  (root, path, expected) => {
    expect(relativeWithinProject(root, path)).toBe(expected);
  },
);
