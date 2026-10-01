import { beforeEach, describe, expect, it } from "vitest";
import {
  inboxNotificationProject,
  knownNotificationProject,
  knownNotificationProjectSelection,
  loadNotificationProjects,
  rememberNotificationProjects,
} from "./notificationProjects";

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

describe("notificationProjects", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("groups Jira notification preferences by site and stable project ID", () => {
    const item = {
      provider: "jira" as const,
      repo: "ENG",
      teamId: "10000",
      teamName: "Engineering",
      url: "https://acme.atlassian.net/browse/ENG-42",
    };
    const project = inboxNotificationProject(item);
    expect(project).toEqual({
      id: "jira:acme.atlassian.net:project:10000",
      name: "Engineering",
      detail: "Jira · acme.atlassian.net",
      kind: "jira",
      paths: [],
    });
    expect(
      inboxNotificationProject({
        ...item,
        repo: "RENAMED",
        url: "https://acme.atlassian.net/browse/RENAMED-1",
      }).id,
    ).toBe(project.id);
    expect(
      inboxNotificationProject({
        ...item,
        url: "https://other.atlassian.net/browse/ENG-42",
      }).id,
    ).not.toBe(project.id);
    rememberNotificationProjects([project]);
    expect(loadNotificationProjects()).toContainEqual(project);
  });

  it("derives local notification identity immediately from the normalized path", () => {
    expect(knownNotificationProject("C:/Work/App")).toEqual({
      id: "local:c:/work/app",
      name: "App",
      detail: "C:/Work/App",
      kind: "local",
      paths: ["C:/Work/App"],
    });
    expect(knownNotificationProject("c:\\work\\app")?.id).toBe(
      "local:c:/work/app",
    );
  });

  it("keeps separate checkout and worktree paths as separate projects", () => {
    const selection = knownNotificationProjectSelection([
      "/work/app",
      "/work/app-review",
    ]);
    expect(selection.projects.map((project) => project.id)).toEqual([
      "local:/work/app",
      "local:/work/app-review",
    ]);
  });

  it("includes requested paths and provider-only catalog projects", () => {
    rememberNotificationProjects([
      {
        id: "linear:project:roadmap",
        name: "Roadmap",
        detail: "Linear",
        kind: "linear",
        paths: [],
      },
      {
        id: "local:/old/path",
        name: "old",
        detail: "/old/path",
        kind: "local",
        paths: ["/old/path"],
      },
    ]);
    expect(
      knownNotificationProjectSelection(["/work/app"]).projects.map(
        (project) => project.id,
      ),
    ).toEqual(["linear:project:roadmap", "local:/work/app"]);
  });

  it("uses the same local ID when Inbox enriches a path with repository metadata", () => {
    const project = inboxNotificationProject({
      provider: "github",
      repo: "acme/app",
      url: "https://github.com/acme/app/pull/5",
      projectPath: "/work/app",
    });
    expect(project).toMatchObject({
      id: "local:/work/app",
      name: "acme/app",
      kind: "repository",
    });
    rememberNotificationProjects([project]);
    expect(knownNotificationProject("/work/app")).toEqual(project);
  });

  it("keeps provider-only repository and Linear identities", () => {
    expect(
      inboxNotificationProject({
        provider: "github",
        repo: "Acme/App",
        url: "git@github.com:Acme/App.git",
      }).id,
    ).toBe("repository:github.com/acme/app");
    expect(
      inboxNotificationProject({
        provider: "linear",
        repo: "PROD",
        url: "https://linear.app/acme/issue/PROD-1",
        projectId: "launch",
        projectName: "Launch",
        teamId: "product",
        teamName: "Product",
      }).id,
    ).toBe("linear:project:launch");
  });
});
