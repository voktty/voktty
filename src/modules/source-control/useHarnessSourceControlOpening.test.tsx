// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestHarnessSourceControl } from "@/modules/source-control/harnessSourceControlRequest";
import { useHarnessSourceControlOpening } from "@/modules/source-control/useHarnessSourceControlOpening";
import { useRepositoryTargeting } from "@/modules/source-control/useRepositoryTargeting";
import { LOCAL_WORKSPACE, useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("@/modules/ai/lib/native", () => ({ native: { gitResolveRepo: mocks.resolve } }));
vi.mock("@/modules/i18n", () => ({ t: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { info: mocks.info, error: mocks.error } }));

const open = vi.fn();
const openHistory = vi.fn();
const contextCurrent = () => true;
let root: Root;
let container: HTMLDivElement;
let targeting: ReturnType<typeof useRepositoryTargeting>;
let sourceKey: string | null;

function Probe({ source }: { source: string | null }) {
  targeting = useRepositoryTargeting({
    spaceId: "main",
    workspaceKey: "local",
    isContextCurrent: contextCurrent,
    openSourceControl: open,
    openCommitHistoryTab: openHistory,
  });
  useHarnessSourceControlOpening({ sourceKey: source, open: targeting.openInSourceControl });
  return null;
}

async function render() {
  await act(async () => root.render(<StrictMode><Probe source={sourceKey} /></StrictMode>));
}

function deferred() {
  let resolve!: (value: { repoRoot: string } | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ repoRoot: string } | null>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.resolve.mockReset();
  mocks.info.mockClear();
  mocks.error.mockClear();
  open.mockClear();
  openHistory.mockClear();
  sourceKey = "harness-project";
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it.each([
  ["/projects/repo/subdir", "/projects/repo"],
  ["/projects/repo/.git/voktty-worktrees/feature", "/projects/repo/.git/voktty-worktrees/feature"],
  ["remote://voktty-ssh-build/work/repo/subdir", "remote://voktty-ssh-build/work/repo"],
])("opens the shared Git panel at the requested repository for %s", async (path, repoRoot) => {
  mocks.resolve.mockResolvedValue({ repoRoot });
  await render();
  await act(async () => { expect(requestHarnessSourceControl(path)).toBe(true); });
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(path, LOCAL_WORKSPACE);
  expect(targeting.repositoryTarget).toEqual({ mode: "fixed", repoRoot, workspaceEnv: LOCAL_WORKSPACE });
  expect(open).toHaveBeenCalledTimes(1);
  expect(openHistory).not.toHaveBeenCalled();
});

it.each([
  ["/local/repo/subdir", "/local/repo"],
  ["remote://voktty-ssh-other/work/repo/subdir", "remote://voktty-ssh-other/work/repo"],
])("keeps the requested project filesystem while an unrelated SSH workspace is selected: %s", async (path, repoRoot) => {
  const ambientSsh: WorkspaceEnv = {
    kind: "ssh",
    root: "/ambient/repo",
    connection: { id: "ambient", host: "ambient.example", name: "Ambient" },
  };
  useWorkspaceEnvStore.setState({ env: ambientSsh });
  mocks.resolve.mockResolvedValue({ repoRoot });
  await render();
  await act(async () => { requestHarnessSourceControl(path); });
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(path, LOCAL_WORKSPACE);
  expect(targeting.repositoryTarget).toEqual({
    mode: "fixed",
    repoRoot,
    workspaceEnv: LOCAL_WORKSPACE,
  });
  expect(open).toHaveBeenCalledTimes(1);
});

it("retires pending publication after a source changes and returns", async () => {
  const pending = deferred();
  mocks.resolve.mockReturnValue(pending.promise);
  await render();
  await act(async () => { requestHarnessSourceControl("/original"); });
  sourceKey = "replacement";
  await render();
  sourceKey = "harness-project";
  await render();
  await act(async () => pending.resolve({ repoRoot: "/original" }));
  expect(targeting.repositoryTarget).toEqual({ mode: "follow-context" });
  expect(open).not.toHaveBeenCalled();
});

it.each(["success", "error"])("suppresses a retired sender's late %s", async (outcome) => {
  const pending = deferred();
  mocks.resolve.mockReturnValue(pending.promise);
  let current = true;
  await render();
  await act(async () => { requestHarnessSourceControl("/original", () => current); });
  current = false;
  await act(async () => {
    if (outcome === "success") pending.resolve({ repoRoot: "/original" });
    else pending.reject(new Error("retired resolution"));
  });
  expect(targeting.repositoryTarget).toEqual({ mode: "follow-context" });
  expect(open).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});

it("keeps the newest request when earlier resolution finishes later", async () => {
  const first = deferred();
  const second = deferred();
  mocks.resolve.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await render();
  await act(async () => {
    requestHarnessSourceControl("/first");
    requestHarnessSourceControl("/second");
  });
  await act(async () => second.resolve({ repoRoot: "/second" }));
  await act(async () => first.resolve({ repoRoot: "/first" }));
  expect(targeting.repositoryTarget).toEqual({ mode: "fixed", repoRoot: "/second", workspaceEnv: LOCAL_WORKSPACE });
  expect(open).toHaveBeenCalledTimes(1);
});

it("rechecks the sender after the repository resolver fulfills", async () => {
  const pending = deferred();
  mocks.resolve.mockReturnValue(pending.promise);
  let current = true;
  await render();
  await act(async () => { requestHarnessSourceControl("/original", () => current); });
  await act(async () => {
    pending.resolve({ repoRoot: "/original" });
    queueMicrotask(() => { current = false; });
  });
  expect(open).not.toHaveBeenCalled();
  expect(targeting.repositoryTarget).toEqual({ mode: "follow-context" });
});

it("keeps unsettled reads bounded across source retirement and recovers after settlement", async () => {
  const pending = deferred();
  mocks.resolve.mockReturnValue(pending.promise);
  await render();
  await act(async () => {
    for (let index = 0; index < 256; index++) requestHarnessSourceControl(`/repo-${index}`);
  });
  sourceKey = "replacement";
  await render();
  await act(async () => { requestHarnessSourceControl("/blocked"); });
  expect(mocks.resolve).toHaveBeenCalledTimes(256);
  await act(async () => pending.resolve({ repoRoot: "/retired" }));
  expect(open).not.toHaveBeenCalled();
  mocks.resolve.mockResolvedValue({ repoRoot: "/current" });
  await act(async () => { requestHarnessSourceControl("/current"); });
  expect(open).toHaveBeenCalledTimes(1);
  expect(targeting.repositoryTarget).toEqual({ mode: "fixed", repoRoot: "/current", workspaceEnv: LOCAL_WORKSPACE });
});

it("reports current resolution failures and missing repositories without opening another target", async () => {
  await render();
  mocks.resolve.mockResolvedValue(null);
  await act(async () => { requestHarnessSourceControl("/missing"); });
  expect(mocks.info).toHaveBeenCalledExactlyOnceWith("feedback.noGitRepository");
  mocks.resolve.mockRejectedValue(new Error("resolution failed"));
  await act(async () => { requestHarnessSourceControl("/failed"); });
  expect(mocks.error).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
  expect(targeting.repositoryTarget).toEqual({ mode: "follow-context" });
});

it("keeps existing direct callers working without a sender guard", async () => {
  mocks.resolve.mockResolvedValue({ repoRoot: "/direct" });
  await render();
  await act(async () => targeting.openInSourceControl("/direct"));
  expect(open).toHaveBeenCalledTimes(1);
  expect(targeting.repositoryTarget).toEqual({ mode: "fixed", repoRoot: "/direct" });
});

it("has no receiver outside an active Harness", async () => {
  sourceKey = null;
  await render();
  expect(requestHarnessSourceControl("/repo")).toBe(false);
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it("observes an unexpected opener rejection and releases its pending reservation", async () => {
  const reject = vi.fn(async () => { throw new Error("opener failed"); });
  function RejectingProbe() {
    useHarnessSourceControlOpening({ sourceKey: "active", open: reject });
    return null;
  }
  await act(async () => root.render(<RejectingProbe />));
  for (let index = 0; index < 257; index++) {
    await act(async () => { requestHarnessSourceControl("/repo"); });
  }
  expect(reject).toHaveBeenCalledTimes(257);
  expect(mocks.error).toHaveBeenCalledTimes(257);
});

it("does not publish unexpected opener errors after its receiver retires", async () => {
  const pending = deferred();
  const opener = async () => { await pending.promise; };
  function PendingProbe() {
    useHarnessSourceControlOpening({ sourceKey: "active", open: opener });
    return null;
  }
  await act(async () => root.render(<PendingProbe />));
  await act(async () => { requestHarnessSourceControl("/repo"); });
  await act(async () => root.render(null));
  expect(requestHarnessSourceControl("/repo")).toBe(false);
  await act(async () => pending.reject(new Error("retired opener")));
  expect(mocks.error).not.toHaveBeenCalled();
});
