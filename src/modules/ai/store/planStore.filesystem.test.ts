import { beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import { usePlanStore } from "@/modules/ai/store/planStore";

const io = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
const local: WorkspaceEnv = { kind: "local" };
const wsl: WorkspaceEnv = { kind: "wsl", distro: "fixture" };
let files: Map<string, string>;
let failPath: string | undefined;
function key(path: string, workspace: WorkspaceEnv) {
  return `${JSON.stringify(workspace)}:${path}`;
}
function edit(id = "first", workspaceEnv?: WorkspaceEnv) {
  return {
    id,
    kind: "edit" as const,
    path: "/repo/file.ts",
    originalContent: "before",
    proposedContent: "after",
    isNewFile: false,
    sessionId: "fixture",
    modelId: "fixture",
    createdAt: 1,
    ...(workspaceEnv ? { workspaceEnv } : {}),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  files = new Map([
    [key("/repo/file.ts", local), "before"],
    [key("/repo/file.ts", wsl), "before"],
  ]);
  failPath = undefined;
  useWorkspaceEnvStore.setState({ env: local });
  usePlanStore.setState({
    active: true,
    queue: [],
    lastOperation: null,
    lastError: null,
    pendingCommands: [],
  });
  io.invoke.mockImplementation(async (command, args) => {
    const target = key(args.path, args.workspace);
    if (command === "fs_inspect_operation_path")
      return files.has(target)
        ? { kind: "file", content: files.get(target) }
        : null;
    if (command === "fs_write_operation_file") {
      if (args.path === failPath) throw new Error("injected failure");
      if ((files.get(target) ?? null) !== args.expectedContent)
        throw new Error("content changed");
      files.set(target, args.content);
      return;
    }
    throw new Error(`Unexpected command ${command}`);
  });
});

it("captures the legacy queue filesystem before selection changes and keeps it for undo", async () => {
  expect(usePlanStore.getState().enqueue(edit()).ok).toBe(true);
  useWorkspaceEnvStore.setState({ env: wsl });
  expect((await usePlanStore.getState().applyAll()).ok).toBe(true);
  expect(files.get(key("/repo/file.ts", local))).toBe("after");
  expect(files.get(key("/repo/file.ts", wsl))).toBe("before");
  expect((await usePlanStore.getState().revertLast()).ok).toBe(true);
  expect(files.get(key("/repo/file.ts", local))).toBe("before");
  expect(files.get(key("/repo/file.ts", wsl))).toBe("before");
});

it("applies identical paths on different filesystems and undoes both originals", async () => {
  expect(usePlanStore.getState().enqueue(edit("local", local)).ok).toBe(true);
  expect(usePlanStore.getState().enqueue(edit("wsl", wsl)).ok).toBe(true);
  expect((await usePlanStore.getState().applyAll()).ok).toBe(true);
  expect(files.get(key("/repo/file.ts", local))).toBe("after");
  expect(files.get(key("/repo/file.ts", wsl))).toBe("after");
  expect((await usePlanStore.getState().revertLast()).ok).toBe(true);
  expect([...files.values()]).toEqual(["before", "before"]);
});

it("detaches queued input and its filesystem from caller mutation", async () => {
  const source: WorkspaceEnv = { kind: "wsl", distro: "fixture" };
  const entry = edit("mutable", source);
  expect(usePlanStore.getState().enqueue(entry).ok).toBe(true);
  source.distro = "replacement";
  entry.path = "/repo/replacement.ts";
  entry.proposedContent = "replacement";
  expect((await usePlanStore.getState().applyAll()).ok).toBe(true);
  expect(files.get(key("/repo/file.ts", wsl))).toBe("after");
  expect(files.get(key("/repo/file.ts", local))).toBe("before");
});

it("rolls back earlier entries on their own filesystem after a later failure", async () => {
  const second = { ...edit("second", local), path: "/repo/fail.ts" };
  files.set(key(second.path, local), "before");
  expect(usePlanStore.getState().enqueue(edit("first", wsl)).ok).toBe(true);
  expect(usePlanStore.getState().enqueue(second).ok).toBe(true);
  failPath = second.path;
  expect((await usePlanStore.getState().applyAll()).ok).toBe(false);
  expect(files.get(key("/repo/file.ts", wsl))).toBe("before");
  expect(files.get(key("/repo/file.ts", local))).toBe("before");
  expect(
    io.invoke.mock.calls
      .filter(([command]) => command === "fs_write_operation_file")
      .map(([, args]) => args.workspace),
  ).toEqual([wsl, local, wsl]);
});

it("rejects native Windows aliases even when their declared workspaces differ", () => {
  expect(
    usePlanStore
      .getState()
      .enqueue({ ...edit("first", local), path: "C:/repo/file.ts" }).ok,
  ).toBe(true);
  expect(
    usePlanStore
      .getState()
      .enqueue({ ...edit("second", wsl), path: "c:\\REPO\\file.ts" }).ok,
  ).toBe(false);
  expect(io.invoke).not.toHaveBeenCalled();
});

it("does not treat SSH labels and session IDs as separate destination files", () => {
  const workspaceEnv: WorkspaceEnv = {
    kind: "ssh",
    connection: { id: "first", name: "First", host: "fixture.invalid" },
    root: "/repo",
    sessionId: 7,
  };
  expect(usePlanStore.getState().enqueue(edit("first", workspaceEnv)).ok).toBe(
    true,
  );
  expect(
    usePlanStore.getState().enqueue(
      edit("second", {
        ...workspaceEnv,
        sessionId: 8,
        connection: {
          ...workspaceEnv.connection,
          id: "second",
          name: "Second",
        },
      }),
    ).ok,
  ).toBe(false);
  expect(io.invoke).not.toHaveBeenCalled();
});
