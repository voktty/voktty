// @vitest-environment happy-dom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BranchCompareDialog } from "@/modules/source-control/BranchCompareDialog";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { useBranchComparison } from "@/modules/source-control/useBranchComparison";

const mocks = vi.hoisted(() => ({ compare: vi.fn(), list: vi.fn() }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitCompareBranches: mocks.compare, gitListBranches: mocks.list },
}));
vi.mock("@/modules/i18n", () => {
  const t = (key: string) => key;
  return { t, useTranslation: () => ({ t: (key: string) => t(key) }) };
});
vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Box,
    DialogContent: Box,
    DialogDescription: Box,
    DialogHeader: Box,
    DialogTitle: Box,
  };
});
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function branches(...names: string[]) {
  return { branches: names.map((name) => ({ name, kind: "local" })) };
}
function data(path: string) {
  return { ahead: [], behind: [], files: [{ path, status: "M" }] };
}
let root: Root;
let container: HTMLDivElement;
const close = vi.fn();
async function render(
  open = true,
  repoRoot = "/project",
  currentBranch = "main",
) {
  await act(async () =>
    root.render(
      <BranchCompareDialog
        open={open}
        onOpenChange={close}
        repoRoot={repoRoot}
        currentBranch={currentBranch}
      />,
    ),
  );
}
async function select(value: string, index = 1) {
  await act(async () => {
    const element = container.querySelectorAll("select")[index];
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
  mocks.list.mockReset().mockResolvedValue(branches("main", "first", "second"));
  mocks.compare.mockReset().mockResolvedValue(data("current-result"));
  close.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("keeps the latest selected comparison when an earlier response arrives last", async () => {
  const first = deferred<ReturnType<typeof data>>();
  const second = deferred<ReturnType<typeof data>>();
  mocks.compare
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await render();
  await select("first");
  await select("second");
  expect(mocks.compare).toHaveBeenCalledTimes(2);
  await act(async () => second.resolve(data("second-result")));
  expect(container.textContent).toContain("second-result");
  await act(async () => first.resolve(data("first-result")));
  expect(container.textContent).toContain("second-result");
  expect(container.textContent).not.toContain("first-result");
});
it("clears a comparison when the selected refs become equal", async () => {
  await render();
  await select("first");
  expect(container.textContent).toContain("current-result");
  await select("main");
  expect(container.textContent).not.toContain("current-result");
  expect(container.textContent).toContain("git.compare.pickBothHint");
  expect(mocks.compare).toHaveBeenCalledTimes(1);
});
it("does not display an earlier opening's branch list after reopening", async () => {
  const old = deferred<ReturnType<typeof branches>>();
  mocks.list
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(branches("main", "fresh"));
  await render();
  await render(false);
  await render();
  expect(container.textContent).toContain("fresh");
  await act(async () => old.resolve(branches("main", "retired-branch")));
  expect(container.textContent).toContain("fresh");
  expect(container.textContent).not.toContain("retired-branch");
});
it("discards a retired comparison error after the filesystem changes", async () => {
  const old = deferred<ReturnType<typeof data>>();
  mocks.compare.mockReturnValueOnce(old.promise);
  await render();
  await select("first");
  await act(async () =>
    useWorkspaceEnvStore.setState({
      env: { kind: "wsl", distro: "test-distro" },
    }),
  );
  await select("second");
  expect(mocks.compare).toHaveBeenLastCalledWith("/project", "main", "second", {
    kind: "wsl",
    distro: "test-distro",
  });
  await act(async () => old.reject(new Error("retired-error")));
  expect(container.textContent).not.toContain("retired-error");
  expect(container.textContent).toContain("current-result");
});

let api: ReturnType<typeof useBranchComparison>;
function Probe({
  open = true,
  path = "/project" as string | null,
  context = "context",
  branch = "main",
  onChange = close,
}) {
  api = useBranchComparison({
    open,
    repoRoot: path,
    currentBranch: branch,
    contextKey: context,
    onOpenChange: onChange,
  });
  return null;
}
async function probe(props: Parameters<typeof Probe>[0] = {}) {
  await act(async () => root.render(<Probe {...props} />));
}
it("retires cached selections, retries and close callbacks when reopened", async () => {
  await probe();
  const retired = api;
  await probe({ open: false });
  await probe();
  const calls = mocks.list.mock.calls.length;
  await act(async () => {
    retired.setCompare("first");
    retired.retryBranches();
    retired.retryComparison();
    retired.setOpen(false);
  });
  expect(mocks.list).toHaveBeenCalledTimes(calls);
  expect(mocks.compare).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(api.compare).toBe("");
});
it("retires synchronously when dismissed before its parent commits", async () => {
  const pending = deferred<ReturnType<typeof data>>();
  mocks.compare.mockReturnValueOnce(pending.promise);
  await probe();
  await act(async () => api.setCompare("first"));
  const retired = api;
  await act(async () => {
    retired.setOpen(false);
    retired.setCompare("second");
    pending.resolve(data("retired-result"));
  });
  expect(close).toHaveBeenCalledExactlyOnceWith(false);
  expect(mocks.compare).toHaveBeenCalledTimes(1);
  expect(api.state.status).not.toBe("ready");
});
it("does not revive a request after an observed filesystem round trip before commit", async () => {
  const pending = deferred<ReturnType<typeof data>>();
  mocks.compare.mockReturnValueOnce(pending.promise);
  await probe();
  await act(async () => api.setCompare("first"));
  const retired = api;
  await act(async () => {
    useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "other" } });
    useWorkspaceEnvStore.setState({ env: { kind: "local" } });
    retired.setCompare("second");
    pending.resolve(data("retired-result"));
  });
  expect(mocks.compare).toHaveBeenCalledTimes(1);
  expect(api.compare).toBe("");
  expect(api.state.status).toBe("idle");
});
it("stamps results by repository and presentation context", async () => {
  const pending = deferred<ReturnType<typeof data>>();
  mocks.compare.mockReturnValueOnce(pending.promise);
  await probe();
  await act(async () => api.setCompare("first"));
  await probe({ path: "/other", context: "replacement" });
  expect(api.state.status).toBe("idle");
  await act(async () => api.setCompare("second"));
  expect(mocks.compare).toHaveBeenLastCalledWith("/other", "main", "second", {
    kind: "local",
  });
  await act(async () => pending.resolve(data("old-repository")));
  expect(api.state).toEqual({ status: "ready", data: data("current-result") });
});
it("clears selections after the current branch changes", async () => {
  await probe();
  await act(async () => api.setCompare("first"));
  await probe({ branch: "second" });
  expect(api.base).toBe("second");
  expect(api.compare).toBe("");
  expect(api.state.status).toBe("idle");
});
it("retires a same-repository comparison after the panel target context changes", async () => {
  const pending = deferred<ReturnType<typeof data>>();
  mocks.compare.mockReturnValueOnce(pending.promise);
  await probe();
  await act(async () => api.setCompare("first"));
  const retired = api;
  await probe({ context: "fixed-target" });
  await act(async () => {
    retired.setCompare("second");
    pending.resolve(data("previous-context"));
  });
  expect(mocks.compare).toHaveBeenCalledTimes(1);
  expect(api.compare).toBe("");
  expect(api.state.status).toBe("idle");
});
it("retains full SSH connection identity for a same-path replacement", async () => {
  const pending = deferred<ReturnType<typeof data>>();
  mocks.compare.mockReturnValueOnce(pending.promise);
  const first = {
    kind: "ssh" as const,
    connection: {
      id: "profile",
      name: "test",
      host: "host-one.example",
      user: "test-user",
    },
    root: "/project",
    sessionId: 11,
  };
  useWorkspaceEnvStore.setState({ env: first });
  await probe();
  await act(async () => api.setCompare("first"));
  expect(mocks.list).toHaveBeenLastCalledWith("/project", first);
  expect(mocks.compare).toHaveBeenLastCalledWith(
    "/project",
    "main",
    "first",
    first,
  );
  const second = {
    ...first,
    connection: { ...first.connection, host: "host-two.example" },
    sessionId: 12,
  };
  await act(async () => useWorkspaceEnvStore.setState({ env: second }));
  await act(async () => api.setCompare("second"));
  expect(mocks.list).toHaveBeenLastCalledWith("/project", second);
  expect(mocks.compare).toHaveBeenLastCalledWith(
    "/project",
    "main",
    "second",
    second,
  );
  await act(async () => pending.resolve(data("retired-host")));
  expect(api.state).toEqual({ status: "ready", data: data("current-result") });
});
it("exposes branch failures and coalesces retry delivery until settlement", async () => {
  mocks.list.mockRejectedValueOnce(new Error("branch-read-failed"));
  await probe();
  expect(api.listError).toBe("branch-read-failed");
  const pending = deferred<ReturnType<typeof branches>>();
  mocks.list.mockReturnValueOnce(pending.promise);
  await act(async () => {
    api.retryBranches();
    api.retryBranches();
  });
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(api.listing).toBe(true);
  await act(async () => pending.resolve(branches("main", "second")));
  expect(api.branches).toEqual(["main", "second"]);
  expect(api.listError).toBeNull();
});
it("retries a current comparison without duplicating a pending retry", async () => {
  mocks.compare.mockRejectedValueOnce(new Error("comparison-failed"));
  await probe();
  await act(async () => api.setCompare("first"));
  expect(api.state).toEqual({ status: "error", message: "comparison-failed" });
  const pending = deferred<ReturnType<typeof data>>();
  mocks.compare.mockReturnValueOnce(pending.promise);
  await act(async () => {
    api.retryComparison();
    api.retryComparison();
  });
  expect(mocks.compare).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(data("retry-result")));
  expect(api.state).toEqual({ status: "ready", data: data("retry-result") });
});
it("does not request a comparison for an unknown, unchanged or equal ref", async () => {
  await probe();
  await act(async () => api.setCompare("not-listed"));
  expect(api.compare).toBe("");
  await act(async () => api.setCompare("first"));
  await act(async () => api.setCompare("first"));
  expect(mocks.compare).toHaveBeenCalledTimes(1);
  await act(async () => api.setBase("first"));
  expect(mocks.compare).toHaveBeenCalledTimes(1);
  expect(api.state.status).toBe("idle");
});
it("retains retired reads against the shared 256-operation limit and recovers after settlement", async () => {
  const pending: ReturnType<typeof deferred<ReturnType<typeof data>>>[] = [];
  mocks.compare.mockImplementation(() => {
    const request = deferred<ReturnType<typeof data>>();
    pending.push(request);
    return request.promise;
  });
  await probe();
  for (let index = 0; index < 256; index++) {
    await act(async () => api.setCompare(index % 2 ? "second" : "first"));
  }
  expect(mocks.compare).toHaveBeenCalledTimes(256);
  await act(async () => api.setCompare("first"));
  expect(mocks.compare).toHaveBeenCalledTimes(256);
  expect(api.state).toEqual({
    status: "error",
    message: "git.waitActionFinish",
  });
  await act(async () => api.retryComparison());
  expect(mocks.compare).toHaveBeenCalledTimes(256);
  await act(async () => pending[0].resolve(data("retired")));
  await act(async () => api.retryComparison());
  expect(mocks.compare).toHaveBeenCalledTimes(257);
  expect(api.state.status).toBe("loading");
  await probe({ open: false });
  await probe();
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(api.listError).toBe("git.waitActionFinish");
  await act(async () => pending[1].resolve(data("retired")));
  await act(async () => api.retryBranches());
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(api.listError).toBeNull();
  await act(async () => api.setCompare("second"));
  expect(mocks.compare).toHaveBeenCalledTimes(258);
  await act(async () => {
    for (const request of pending) request.resolve(data("settled"));
  });
});
it("preserves current work after StrictMode effect replay and equivalent environment publication", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    ),
  );
  await act(async () =>
    useWorkspaceEnvStore.setState({ env: { kind: "local" } }),
  );
  await act(async () => api.setCompare("second"));
  expect(mocks.compare).toHaveBeenCalledExactlyOnceWith(
    "/project",
    "main",
    "second",
    { kind: "local" },
  );
  expect(api.state).toEqual({ status: "ready", data: data("current-result") });
});
it("allows dismissal while repository discovery has no target", async () => {
  await probe({ path: null });
  expect(mocks.list).not.toHaveBeenCalled();
  expect(api.listing).toBe(false);
  await act(async () => api.setOpen(false));
  expect(close).toHaveBeenCalledExactlyOnceWith(false);
});
it("retires cached dialog callbacks when the close owner changes", async () => {
  await probe();
  const retired = api;
  const replacement = vi.fn();
  await probe({ onChange: replacement });
  await act(async () => {
    retired.setOpen(false);
    retired.setCompare("first");
  });
  expect(close).not.toHaveBeenCalled();
  expect(replacement).not.toHaveBeenCalled();
  expect(mocks.compare).not.toHaveBeenCalled();
  await act(async () => api.setOpen(false));
  expect(replacement).toHaveBeenCalledExactlyOnceWith(false);
});
