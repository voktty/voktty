// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  rememberRemoteProject,
  forgetRemoteProject,
} from "@/modules/connections/model/remoteProjects";
import { newSession } from "@/modules/harness/lib/session";
import { newTab } from "@/modules/harness/lib/layout";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";

const io = vi.hoisted(() => ({
  native: vi.fn(),
  remote: vi.fn(),
  files: new Map<string, string>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.native }));
vi.mock("@/modules/harness/lib/fs", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/fs")>()),
  invokeWorkspace: io.remote,
}));
let store: typeof import("@/modules/harness/lib/sessionStore");
let lifecycle: typeof import("@/modules/harness/lib/appLifecycle");
const cwd = "remote://restore-host/srv/project";
function record(id: string, path = cwd) {
  return {
    ...newSession("claude", path),
    id,
    title: "Stored remote transcript",
    blocks: [{ id: "user", role: "user" as const, text: "saved history" }],
    createdAt: 1,
    updatedAt: 1,
  };
}
function save(id: string) {
  io.files.set(
    `${cwd}/.voktty/sessions/${id}.json`,
    JSON.stringify({
      version: 1,
      ...record(id, "/srv/project"),
    }),
  );
}
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  rememberRemoteProject("restore-host", {
    id: "project",
    name: "project",
    cwd: "/srv/project",
  });
  io.files.clear();
  io.native.mockReset().mockResolvedValue(null);
  io.remote
    .mockReset()
    .mockImplementation(async (command: string, args: { path: string }) => {
      if (command === "read_text_file") {
        const found = io.files.get(args.path);
        if (found === undefined) throw new Error("path does not exist");
        return found;
      }
      if (command === "write_text_file") return;
      throw new Error(`Unexpected remote restore operation: ${command}`);
    });
  store = await import("@/modules/harness/lib/sessionStore");
  lifecycle = await import("@/modules/harness/lib/appLifecycle");
});

it("reads a cold remote transcript from its saved project without a prior history listing", async () => {
  save("cold");
  expect(await store.getSession("cold", undefined, cwd)).toMatchObject({
    id: "cold",
    cwd,
    blocks: [{ text: "saved history" }],
  });
  expect(io.remote).toHaveBeenCalledWith("read_text_file", {
    path: `${cwd}/.voktty/sessions/cold.json`,
  });
  expect(io.native).not.toHaveBeenCalled();
});

it("refuses an unknown remote source instead of reading a same-ID local cache or SQLite", async () => {
  store.cacheSession(record("cached", "/work/local"));
  expect(
    await store.getSession(
      "cached",
      undefined,
      "remote://restore-host/outside",
    ),
  ).toBeNull();
  expect(io.remote).not.toHaveBeenCalled();
  expect(io.native).not.toHaveBeenCalled();
});

it("does not let a same-ID local cache replace a requested remote transcript", async () => {
  store.cacheSession({
    ...record("collision", "/work/local"),
    title: "Local cache",
  });
  save("collision");
  expect(await store.getSession("collision", undefined, cwd)).toMatchObject({
    title: "Stored remote transcript",
    cwd,
  });
  expect(io.native).not.toHaveBeenCalled();
});

it("uses an explicit local source even after the same ID acquired a remote home", async () => {
  save("local");
  await store.getSession("local", undefined, cwd);
  io.native.mockResolvedValue(record("local", "/work/local"));
  io.remote.mockClear();
  expect(
    await store.getSession("local", undefined, "/work/local"),
  ).toMatchObject({ cwd: "/work/local" });
  expect(io.native).toHaveBeenCalledWith("session_get", { sessionId: "local" });
  expect(io.remote).not.toHaveBeenCalled();
});

it("propagates remote read failure without trying local storage", async () => {
  const failure = new Error("remote disconnected");
  io.remote.mockRejectedValue(failure);
  await expect(store.getSession("failed", undefined, cwd)).rejects.toBe(
    failure,
  );
  expect(io.native).not.toHaveBeenCalled();
});

it("rechecks the saved project before returning a cached remote conversation", async () => {
  save("forgotten");
  await store.getSession("forgotten", undefined, cwd);
  forgetRemoteProject(cwd);
  io.remote.mockClear();
  expect(await store.getSession("forgotten", undefined, cwd)).toBeNull();
  expect(io.remote).not.toHaveBeenCalled();
  expect(io.native).not.toHaveBeenCalled();
});

it("loads real remote transcripts from both snapshot stubs and interrupted references during boot", async () => {
  save("snapshot");
  save("interrupted");
  const tab = newTab("snapshot");
  io.native.mockImplementation(async (command: string) => {
    if (command === "workspace_get_snapshot")
      return {
        tabs: [tab],
        sessions: [record("snapshot")],
        activeTabId: tab.id,
        projectCwd: cwd,
        projectTerminals: [],
      };
    if (command === "session_list_in_flight")
      return [
        { sessionId: "interrupted", cwd },
        { sessionId: "snapshot", cwd: "/work/local" },
      ];
    throw new Error(`Unexpected local restore operation: ${command}`);
  });
  const restored = await lifecycle.loadResumedWorkspace();
  expect(restored?.sessions.map((session) => session.id).sort()).toEqual([
    "interrupted",
    "snapshot",
  ]);
  expect(
    restored?.sessions.every((session) =>
      session.blocks.some((block) => block.text === "saved history"),
    ),
  ).toBe(true);
  expect(
    restored?.sessions
      .find((session) => session.id === "interrupted")
      ?.blocks.some((block) => block.notice === "interrupt"),
  ).toBe(true);
  expect(io.native.mock.calls.map(([command]) => command)).not.toContain(
    "session_get",
  );
});

it("keeps a live cache after a captured remote read survives close cancellation", async () => {
  const authority = createPersistenceAdmission();
  const owner = authority.createOwner();
  const permit = owner.capture();
  if (!permit) throw new Error("Missing read permit");
  let resolve!: (text: string) => void;
  const pending = new Promise<string>((yes) => {
    resolve = yes;
  });
  const original = io.remote.getMockImplementation();
  io.remote.mockImplementation((command, args) =>
    args.path.endsWith("/retired.json") ? pending : original?.(command, args),
  );
  const reading = store.getSession("retired", permit, cwd);
  await vi.waitFor(() => expect(io.remote).toHaveBeenCalled());
  const final = permit.seal();
  if (!final) throw new Error("Missing close receipt");
  final.cancel();
  const live = { ...record("retired"), title: "Live transcript" };
  store.cacheSession(live);
  resolve(JSON.stringify({ version: 1, ...record("retired", "/srv/project") }));
  await reading;
  expect(store.getCachedSession("retired")?.title).toBe("Live transcript");
  owner.retire();
});
