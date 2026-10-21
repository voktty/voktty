import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirs: new Set<string>(),
  failWrites: false,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: host.invoke }));
vi.mock("./fs", () => ({
  deleteGeneratedImages: vi.fn(),
  invokeWorkspace: async (command: string, args: Record<string, string | boolean>) => {
    const missing = () => {
      throw new Error("io_error: path does not exist");
    };
    if (command === "read_text_file") {
      const found = host.files.get(args.path as string);
      return found === undefined ? missing() : found;
    }
    if (command === "write_text_file") {
      if (host.failWrites) throw new Error("write_failed: permission denied");
      const path = args.path as string;
      const parent = path.slice(0, path.lastIndexOf("/"));
      if (!host.dirs.has(parent)) return missing();
      host.files.set(path, args.content as string);
      return undefined;
    }
    if (command === "create_path") {
      const dir = `${args.parent}/${args.name}`.replace(/\/+/g, "/").replace("remote:/", "remote://");
      if (host.dirs.has(dir)) throw new Error("io_error: path already exists");
      host.dirs.add(dir);
      return dir;
    }
    if (command === "list_dir") {
      const base = args.path as string;
      if (!host.dirs.has(base)) return missing();
      return [...host.files.keys()]
        .filter((key) => key.startsWith(`${base}/`) && !key.slice(base.length + 1).includes("/"))
        .map((key) => ({ name: key.slice(base.length + 1), isDir: false }));
    }
    if (command === "delete_path") {
      host.files.delete(args.path as string);
      return undefined;
    }
    throw new Error(`unexpected ${command}`);
  },
}));

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

import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import {
  resetRemoteSessionProblems,
  subscribeRemoteSessionProblems,
} from "./remoteSessionAlerts";
import {
  deleteSession,
  getSession,
  listSessionsByProject,
  setSessionArchived,
  shouldPersistSession,
  upsertSession,
} from "./sessionStore";

const env = "voktty-ssh-p1";
const project = `remote://${env}/srv/app`;
const root = `remote://${env}/srv/app`;

const session = (id: string, cwd = project) =>
  ({
    id,
    cwd,
    harness: "codex",
    model: "gpt",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Remote chat",
    blocks: [{ id: "b1", role: "user", text: "hola" }],
    busy: false,
  }) as never;

beforeEach(() => {
  host.files.clear();
  host.dirs.clear();
  host.failWrites = false;
  host.dirs.add(root);
  host.invoke.mockReset().mockRejectedValue(new Error("local store must not be used"));
  localStorage.clear();
  rememberRemoteProject(env, { id: "p", cwd: "/srv/app", name: "app" });
});

describe("conversations of a remote project", () => {
  it("are persisted only inside a saved remote project", () => {
    expect(shouldPersistSession(session("a"))).toBe(true);
    expect(shouldPersistSession(session("a", `remote://${env}/etc`))).toBe(false);
  });

  it("are written under .voktty in the project and never touch the local store", async () => {
    const summary = await upsertSession(session("s1"));
    expect(summary).toMatchObject({ id: "s1", cwd: project });
    expect([...host.files.keys()].sort()).toEqual([
      `${root}/.voktty/.gitignore`,
      `${root}/.voktty/sessions/s1.json`,
      `${root}/.voktty/sessions/s1.meta.json`,
    ]);
    expect(host.invoke).not.toHaveBeenCalled();
    const stored = JSON.parse(host.files.get(`${root}/.voktty/sessions/s1.json`) as string);
    expect(stored.cwd).toBe("/srv/app");
  });

  it("load again from the folder, with the connection of this computer", async () => {
    await upsertSession(session("s1"));
    // Another computer wrote the same folder through a different profile.
    host.files.set(
      `${root}/.voktty/sessions/s2.meta.json`,
      JSON.stringify({
        version: 1, id: "s2", cwd: "/srv/app", harness: "claude", title: "From elsewhere",
        model: "m", runtimeMode: "supervised", createdAt: 1, updatedAt: 2,
      }),
    );
    host.files.set(
      `${root}/.voktty/sessions/s2.json`,
      JSON.stringify({
        version: 1, id: "s2", cwd: "remote://voktty-ssh-old/srv/app", harness: "claude",
        model: "m", modelSettings: {}, runtimeMode: "supervised", title: "From elsewhere",
        blocks: [{ id: "u", role: "user", text: "hi" }], createdAt: 1, updatedAt: 2,
      }),
    );

    const rows = await listSessionsByProject(project);
    expect(rows.map((row) => row.id).sort()).toEqual(["s1", "s2"]);
    expect(rows.every((row) => row.cwd === project)).toBe(true);

    const opened = await getSession("s2");
    expect(opened?.cwd).toBe(project);
    expect(opened?.blocks[0]?.text).toBe("hi");
  });

  it("archive and delete act on the folder's files", async () => {
    await upsertSession(session("s1"));
    await listSessionsByProject(project);
    await setSessionArchived("s1", true);
    expect((await listSessionsByProject(project))[0].archived).toBe(true);
    await deleteSession("s1");
    expect(await listSessionsByProject(project)).toEqual([]);
    expect([...host.files.keys()].filter((key) => key.includes("s1"))).toEqual([]);
  });

  it("only list the conversations that belong to the requested folder", async () => {
    await upsertSession(session("inside", `remote://${env}/srv/app/pkg`));
    await upsertSession(session("root"));
    const sub = await listSessionsByProject(`remote://${env}/srv/app/pkg`);
    expect(sub.map((row) => row.id)).toEqual(["inside"]);
    expect((await listSessionsByProject(project)).map((row) => row.id).sort()).toEqual([
      "inside",
      "root",
    ]);
  });

  it("reports a conversation that cannot be written instead of dropping it silently", async () => {
    resetRemoteSessionProblems();
    const problems: { kind: string; message: string }[] = [];
    const stop = subscribeRemoteSessionProblems((problem) =>
      problems.push(problem),
    );
    host.failWrites = true;

    await expect(upsertSession(session("fresh"))).rejects.toThrow();

    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe("save-failed");
    stop();
  });

  it("says so when the folder is not a saved project", async () => {
    resetRemoteSessionProblems();
    const problems: { kind: string }[] = [];
    const stop = subscribeRemoteSessionProblems((problem) =>
      problems.push(problem),
    );

    const summary = await upsertSession(session("lost", `remote://${env}/etc`));

    expect(summary).toBeNull();
    expect(problems.map((problem) => problem.kind)).toEqual(["no-saved-project"]);
    expect(host.files.size).toBe(0);
    stop();
  });
});