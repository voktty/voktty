// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBranchDropdown } from "@/modules/source-control/useBranchDropdown";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import type { GitBranchListResult } from "@/modules/ai/lib/native";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  checkout: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitListBranches: mocks.list, gitCheckoutBranch: mocks.checkout },
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
const local: WorkspaceEnv = { kind: "local" };
const branches: GitBranchListResult = {
  branches: [
    {
      name: "feature",
      kind: "local",
      worktreePath: null,
      isHead: false,
      isDetached: false,
    },
  ],
};
const refresh = vi.fn();
let root: Root;
let view: ReturnType<typeof useBranchDropdown>;
function Probe({
  path = "/repo",
  context = "follow",
}: {
  path?: string;
  context?: string;
}) {
  view = useBranchDropdown({
    repoRoot: path,
    contextKey: context,
    onRefresh: refresh,
  });
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const open = () => act(async () => view.setOpen(true));
const close = () => act(async () => view.setOpen(false));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useWorkspaceEnvStore.setState({ env: local });
  mocks.list.mockReset().mockResolvedValue(branches);
  mocks.checkout.mockReset().mockResolvedValue(undefined);
  mocks.error.mockReset();
  refresh.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  useWorkspaceEnvStore.setState({ env: local });
  vi.unstubAllGlobals();
});
it("does no Git work until its menu opens", async () => {
  await act(async () => root.render(<Probe />));
  expect(mocks.list).not.toHaveBeenCalled();
  await act(async () => view.checkout("feature"));
  expect(mocks.checkout).not.toHaveBeenCalled();
});
it.each<WorkspaceEnv>([
  local,
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "ssh",
    sessionId: 7,
    root: "/repo",
    connection: { id: "build", name: "Build", host: "build.example" },
  },
  {
    kind: "docker",
    connection: { containerId: "box", containerName: "Box", image: "image" },
  },
])(
  "retains the exact $kind filesystem for reads and checkout",
  async (workspace) => {
    useWorkspaceEnvStore.setState({ env: workspace });
    await act(async () => root.render(<Probe />));
    await open();
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("/repo", workspace);
    expect(mocks.list.mock.calls[0][1]).not.toBe(workspace);
    await act(async () => view.checkout("feature"));
    expect(mocks.checkout).toHaveBeenCalledExactlyOnceWith(
      "/repo",
      "feature",
      workspace,
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(view.open).toBe(false);
    expect(view.checkingOut).toBe(false);
  },
);
it("discards a closed menu's late read and error without overwriting its replacement", async () => {
  const old = deferred<GitBranchListResult>();
  mocks.list.mockReturnValueOnce(old.promise);
  await act(async () => root.render(<Probe />));
  await open();
  await close();
  await open();
  await act(async () => old.reject(new Error("Old read")));
  expect(view.branches).toEqual(branches.branches);
  expect(view.error).toBeNull();
});
it("retires cached checkout and navigation after a menu round trip", async () => {
  await act(async () => root.render(<Probe />));
  await open();
  const old = view;
  await close();
  await open();
  const action = vi.fn();
  await act(async () => {
    await old.checkout("feature");
    old.runMenuAction(action);
  });
  expect(mocks.checkout).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
  await act(async () => view.runMenuAction(action));
  expect(action).toHaveBeenCalledOnce();
  await act(async () => view.runMenuAction(action));
  expect(action).toHaveBeenCalledOnce();
});
it("lets an admitted checkout finish after normal menu dismissal and refuses duplicates", async () => {
  const pending = deferred<void>();
  mocks.checkout.mockReturnValue(pending.promise);
  await act(async () => root.render(<Probe />));
  await open();
  const captured = view.checkout;
  let work!: Promise<void>;
  await act(async () => {
    work = captured("feature");
    await captured("feature");
  });
  await close();
  expect(view.checkingOut).toBe(true);
  await act(async () => {
    pending.resolve();
    await work;
  });
  expect(mocks.checkout).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledOnce();
  expect(view.checkingOut).toBe(false);
});
it("does not let an old checkout close or clear a successor menu", async () => {
  const pending = deferred<void>();
  mocks.checkout.mockReturnValueOnce(pending.promise);
  await act(async () => root.render(<Probe />));
  await open();
  let work!: Promise<void>;
  await act(async () => {
    work = view.checkout("feature");
  });
  await act(async () => root.render(<Probe path="/other" />));
  expect(view.checkingOut).toBe(false);
  await open();
  await act(async () => {
    pending.resolve();
    await work;
  });
  expect(view.open).toBe(true);
  expect(view.branches).toEqual(branches.branches);
  expect(refresh).not.toHaveBeenCalled();
});
it("permanently retires authority across a filesystem round trip before React commits", async () => {
  const pending = deferred<void>();
  mocks.checkout.mockReturnValueOnce(pending.promise);
  await act(async () => root.render(<Probe />));
  await open();
  const old = view;
  let work!: Promise<void>;
  await act(async () => {
    work = view.checkout("feature");
  });
  await act(async () => {
    useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Ubuntu" } });
    useWorkspaceEnvStore.setState({ env: local });
    pending.resolve();
    await work;
    await old.checkout("feature");
  });
  expect(mocks.checkout).toHaveBeenCalledOnce();
  expect(refresh).not.toHaveBeenCalled();
  expect(view.open).toBe(false);
});
it("retains retired reads in its budget until settlement and permits explicit reopening afterward", async () => {
  const pending: ReturnType<typeof deferred<GitBranchListResult>>[] = [];
  mocks.list.mockImplementation(() => {
    const next = deferred<GitBranchListResult>();
    pending.push(next);
    return next.promise;
  });
  await act(async () => root.render(<Probe />));
  for (let index = 0; index < 257; index++) {
    await open();
    if (index < 256) await close();
  }
  expect(mocks.list).toHaveBeenCalledTimes(256);
  expect(view.loading).toBe(false);
  expect(view.error).toBe("Wait for the current Git action to finish.");
  await act(async () => pending[0].resolve(branches));
  await close();
  await open();
  expect(mocks.list).toHaveBeenCalledTimes(257);
  await act(async () => {
    for (const item of pending) item.resolve(branches);
  });
  expect(view.branches).toEqual(branches.branches);
});
it("preserves current failures and prevents unlisted checkout targets", async () => {
  await act(async () => root.render(<Probe />));
  await open();
  await act(async () => view.checkout("unknown"));
  expect(mocks.checkout).not.toHaveBeenCalled();
  mocks.checkout.mockRejectedValueOnce(new Error("Current checkout"));
  await act(async () => view.checkout("feature"));
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(refresh).not.toHaveBeenCalled();
});
