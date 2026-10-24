// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useKanbanVault } from "./useKanbanVault";
import type { VaultTarget } from "./vaultFilesystem";
import { useKanbanStore } from "@/modules/notes-board/store/kanbanStore";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  create: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  listDir: mocks.list,
  readTextFile: mocks.read,
  writeTextFile: mocks.write,
  createPath: mocks.create,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error, info: mocks.info },
}));

let node: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useKanbanVault>;
let original: ReturnType<typeof useKanbanStore.getState>;
const local: VaultTarget = { path: "/project", workspace: { kind: "local" } };
function Probe({
  target,
  source = "first",
}: {
  target: VaultTarget | null;
  source?: string;
}) {
  api = useKanbanVault(target, source);
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
async function render(target: VaultTarget | null = local, source = "first") {
  await act(async () => root.render(<Probe target={target} source={source} />));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.read.mockResolvedValue("Task body");
  mocks.write.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue(undefined);
  original = useKanbanStore.getState();
  useKanbanStore.setState({ cards: [] });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  useKanbanStore.setState(original);
  node.remove();
  vi.unstubAllGlobals();
});

it("merges a current import only after every column settles", async () => {
  mocks.list.mockResolvedValueOnce([{ name: "task.md", isDir: false }]);
  const last = deferred<[]>();
  mocks.list
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockReturnValueOnce(last.promise);
  await render();
  let operation!: Promise<void>;
  await act(async () => {
    operation = api.run("import");
  });
  expect(api.syncing).toBe(true);
  expect(useKanbanStore.getState().cards).toEqual([]);
  await act(async () => {
    last.resolve([]);
    await operation;
  });
  expect(useKanbanStore.getState().cards).toHaveLength(1);
  expect(useKanbanStore.getState().cards[0].sourceCwd).toBe("/project");
  expect(mocks.success).toHaveBeenCalledOnce();
  expect(api.syncing).toBe(false);
});

it.each(["path", "source", "filesystem", "close"])(
  "suppresses later import and notifications after %s retirement",
  async (change) => {
    const read = deferred<string>();
    mocks.list.mockResolvedValueOnce([{ name: "task.md", isDir: false }]);
    mocks.read.mockReturnValueOnce(read.promise);
    await render();
    let operation!: Promise<void>;
    await act(async () => {
      operation = api.run("import");
    });
    expect(mocks.read).toHaveBeenCalledOnce();
    if (change === "path") await render({ ...local, path: "/other" });
    else if (change === "filesystem")
      await render({
        path: local.path,
        workspace: { kind: "wsl", distro: "Test" },
      });
    else if (change === "source") await render(local, "second");
    else await act(async () => root.render(null));
    await act(async () => {
      read.resolve("Late task");
      await operation;
    });
    expect(useKanbanStore.getState().cards).toEqual([]);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledOnce();
  },
);

it("never revives an old callback when the same source returns", async () => {
  await render();
  const old = api.run;
  await render(local, "second");
  await render();
  await act(async () => {
    await old("import");
  });
  expect(mocks.list).not.toHaveBeenCalled();
  await act(async () => {
    await api.run("import");
  });
  expect(mocks.list).toHaveBeenCalledTimes(4);
});

it("coalesces simultaneous actions and retains the pending slot across source retirement", async () => {
  const first = deferred<[]>();
  mocks.list.mockReturnValueOnce(first.promise);
  await render();
  let operation!: Promise<void>;
  await act(async () => {
    operation = api.run("import");
    await api.run("export");
  });
  expect(mocks.list).toHaveBeenCalledOnce();
  expect(mocks.create).not.toHaveBeenCalled();
  await render(local, "second");
  await act(async () => {
    await api.run("import");
  });
  expect(mocks.list).toHaveBeenCalledOnce();
  await act(async () => {
    first.resolve([]);
    await operation;
  });
  expect(api.syncing).toBe(false);
  await act(async () => {
    await api.run("import");
  });
  expect(mocks.list).toHaveBeenCalledTimes(5);
});

it("observes a retired rejection without publishing an error or admitting later work", async () => {
  const first = deferred<[]>();
  mocks.list.mockReturnValueOnce(first.promise);
  await render();
  let operation!: Promise<void>;
  await act(async () => {
    operation = api.run("import");
  });
  await render(null);
  await act(async () => {
    first.reject(new Error("Connection lost"));
    await operation;
  });
  expect(mocks.error).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledOnce();
});

it("reports a current failure and permits an explicit retry", async () => {
  mocks.list.mockRejectedValueOnce(new Error("Permission denied"));
  await render();
  await act(async () => {
    await api.run("import");
  });
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(api.syncing).toBe(false);
  await act(async () => {
    await api.run("import");
  });
  expect(mocks.info).toHaveBeenCalledOnce();
  expect(mocks.success).not.toHaveBeenCalled();
});

it("starts no IO when mounted or replayed in StrictMode and rejects absent targets", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe target={local} />
      </StrictMode>,
    ),
  );
  expect(mocks.list).not.toHaveBeenCalled();
  await render(null);
  expect(api.available).toBe(false);
  await act(async () => {
    await api.run("import");
  });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("treats equivalent metadata objects as the same source", async () => {
  const first = deferred<[]>();
  mocks.list.mockReturnValueOnce(first.promise);
  await render();
  let operation!: Promise<void>;
  await act(async () => {
    operation = api.run("import");
  });
  await render(structuredClone(local));
  await act(async () => {
    first.resolve([]);
    await operation;
  });
  expect(mocks.info).toHaveBeenCalledOnce();
  expect(mocks.list).toHaveBeenCalledTimes(4);
});
