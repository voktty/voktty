// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConflictsPanel } from "@/modules/source-control/useConflictsPanel";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import type { GitChangedFile } from "@/modules/ai/lib/native";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  abort: vi.fn(),
  next: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    gitOperationStatus: mocks.status,
    gitOperationAbort: mocks.abort,
    gitOperationContinue: mocks.next,
  },
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
const local: WorkspaceEnv = { kind: "local" };
const file: GitChangedFile = {
  path: "a.ts",
  originalPath: null,
  indexStatus: "U",
  worktreeStatus: "U",
  staged: false,
  unstaged: true,
  untracked: false,
  conflicted: true,
  statusLabel: "conflict",
};
const refresh = vi.fn();
let root: Root;
let view: ReturnType<typeof useConflictsPanel>;
function Probe({
  path = "/repo",
  files = [],
}: {
  path?: string;
  files?: GitChangedFile[];
}) {
  view = useConflictsPanel(path, files, refresh);
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
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useWorkspaceEnvStore.setState({ env: local });
  mocks.status.mockReset().mockResolvedValue({ kind: "merge" });
  mocks.abort.mockReset().mockResolvedValue(undefined);
  mocks.next.mockReset().mockResolvedValue(undefined);
  mocks.success.mockReset();
  mocks.error.mockReset();
  refresh.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  useWorkspaceEnvStore.setState({ env: local });
  vi.unstubAllGlobals();
});
it("rejects status from a retired repository instead of overwriting the successor", async () => {
  const old = deferred<{ kind: string }>();
  mocks.status
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ kind: "rebase" });
  await act(async () => root.render(<Probe />));
  await act(async () => root.render(<Probe path="/new" />));
  await act(async () => old.resolve({ kind: "merge" }));
  expect(view.operation).toBe("rebase");
});
it.each(["abort", "continue"] as const)(
  "guards duplicate %s and keeps its original filesystem",
  async (action) => {
    const pending = deferred<void>();
    const run = action === "abort" ? mocks.abort : mocks.next;
    run.mockReturnValueOnce(pending.promise);
    const workspace: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
    useWorkspaceEnvStore.setState({ env: workspace });
    await act(async () => root.render(<Probe />));
    const captured = view.run;
    let work!: Promise<void>;
    await act(async () => {
      work = captured(action);
      await captured(action);
    });
    expect(run).toHaveBeenCalledExactlyOnceWith("/repo", "merge", workspace);
    mocks.status.mockResolvedValue({ kind: "none" });
    await act(async () => {
      pending.resolve();
      await work;
    });
    expect(view.operation).toBe("none");
    expect(view.busy).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
  },
);
it.each(["abort", "continue"] as const)(
  "retires a late %s completion across a filesystem round trip",
  async (action) => {
    const pending = deferred<void>();
    const run = action === "abort" ? mocks.abort : mocks.next;
    run.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<Probe />));
    let work!: Promise<void>;
    await act(async () => {
      work = view.run(action);
    });
    await act(async () => {
      useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Ubuntu" } });
      useWorkspaceEnvStore.setState({ env: local });
      pending.resolve();
      await work;
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(view.busy).toBeNull();
  },
);
it("does not continue while current conflict facts still contain files", async () => {
  await act(async () => root.render(<Probe files={[file]} />));
  await act(async () => view.run("continue"));
  expect(mocks.next).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledOnce();
});
it("coalesces refreshes and discards the superseded read", async () => {
  const pending = deferred<{ kind: string }>();
  mocks.status
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ kind: "rebase" });
  await act(async () => root.render(<Probe />));
  await act(async () => {
    for (let i = 0; i < 20; i++)
      window.dispatchEvent(new CustomEvent("voktty:git-refresh"));
  });
  expect(mocks.status).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ kind: "merge" }));
  expect(mocks.status).toHaveBeenCalledTimes(2);
  expect(view.operation).toBe("rebase");
});
it("retains file-write admission across dialog cancellation without closing a successor", async () => {
  await act(async () => root.render(<Probe files={[file]} />));
  await act(async () => view.openFile("a.ts"));
  const old = view.dialog;
  if (!old) throw new Error("Missing dialog");
  let release!: () => void;
  await act(async () => {
    const ticket = old.admit("resolve");
    if (!ticket) throw new Error("Missing ticket");
    release = ticket;
  });
  await act(async () => old.close(false));
  await act(async () => view.openFile("a.ts"));
  const next = view.dialog;
  if (!next) throw new Error("Missing successor");
  expect(next.key).not.toBe(old.key);
  expect(next.admit("resolve")).toBeNull();
  await act(async () => {
    old.resolved();
    release();
  });
  expect(view.dialog?.key).toBe(next.key);
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => {
    const finish = next.admit("resolve");
    expect(finish).not.toBeNull();
    finish?.();
  });
});
it("does not adopt a retired StrictMode reader merely because its binding matches", async () => {
  const pending = deferred<{ kind: string }>();
  mocks.status
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ kind: "rebase" });
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    ),
  );
  expect(mocks.status).toHaveBeenCalledTimes(2);
  expect(view.operation).toBe("rebase");
  await act(async () => pending.resolve({ kind: "merge" }));
  expect(view.operation).toBe("rebase");
});
it("keeps exhausted readers bounded and offers explicit retry after settlement", async () => {
  const pending: ReturnType<typeof deferred<{ kind: string }>>[] = [];
  mocks.status.mockImplementation(() => {
    const item = deferred<{ kind: string }>();
    pending.push(item);
    return item.promise;
  });
  for (let index = 0; index <= 256; index++)
    await act(async () => root.render(<Probe path={`/repo-${index}`} />));
  expect(mocks.status).toHaveBeenCalledTimes(256);
  expect(view.error).toBe("Wait for the current Git action to finish.");
  await act(async () => pending[0].resolve({ kind: "none" }));
  let retry!: Promise<void>;
  await act(async () => {
    retry = view.loadOperation();
  });
  expect(mocks.status).toHaveBeenCalledTimes(257);
  await act(async () => {
    for (const item of pending) item.resolve({ kind: "merge" });
    await retry;
  });
  expect(view.operation).toBe("merge");
});
