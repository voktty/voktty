// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useExplorerRepository } from "@/modules/explorer/lib/useExplorerRepository";
import type { WorkspaceEnv } from "@/modules/workspace";

const resolveRepo = vi.hoisted(() => vi.fn());
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitResolveRepo: resolveRepo },
}));
let root: Root;
let view: ReturnType<typeof useExplorerRepository>;
const scope = {};
const local: WorkspaceEnv = { kind: "local" };
function Probe({
  path = "/project",
  workspace = local,
  owner = scope,
}: {
  path?: string;
  workspace?: WorkspaceEnv;
  owner?: object;
}) {
  view = useExplorerRepository({ scope: owner, rootPath: path, workspace });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resolveRepo.mockReset().mockResolvedValue(null);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it.each([false, true])(
  "reports only the visible root's repository metadata (%s)",
  async (exists) => {
    resolveRepo.mockResolvedValue(exists ? { repoRoot: "/project" } : null);
    await act(async () => root.render(<Probe />));
    expect(view.hasRepo).toBe(exists);
    expect(resolveRepo).toHaveBeenCalledExactlyOnceWith("/project", local);
  },
);
it.each<WorkspaceEnv>([
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "ssh",
    root: "/project",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  },
])("resolves the captured explicit $kind filesystem", async (workspace) => {
  await act(async () => root.render(<Probe workspace={workspace} />));
  expect(resolveRepo).toHaveBeenCalledExactlyOnceWith("/project", workspace);
  expect(resolveRepo.mock.calls[0][1]).not.toBe(workspace);
});
it("does not reload equivalent filesystem publications", async () => {
  await act(async () => root.render(<Probe workspace={{ kind: "local" }} />));
  await act(async () => root.render(<Probe workspace={{ kind: "local" }} />));
  expect(resolveRepo).toHaveBeenCalledTimes(1);
});
it("discards a late root result instead of replacing the current repository fact", async () => {
  const completions: ((value: object | null) => void)[] = [];
  resolveRepo.mockImplementation(
    () => new Promise((resolve) => completions.push(resolve)),
  );
  await act(async () => root.render(<Probe path="/old" />));
  await act(async () => root.render(<Probe path="/current" />));
  await act(async () => completions[1](null));
  await act(async () => completions[0]({ repoRoot: "/old" }));
  expect(view.hasRepo).toBe(false);
});
it("cannot revive a pending result after a filesystem round trip", async () => {
  const completions: ((value: object | null) => void)[] = [];
  resolveRepo.mockImplementation(
    () => new Promise((resolve) => completions.push(resolve)),
  );
  await act(async () => root.render(<Probe />));
  await act(async () =>
    root.render(<Probe workspace={{ kind: "wsl", distro: "Ubuntu" }} />),
  );
  await act(async () => root.render(<Probe />));
  await act(async () => {
    completions[0]({ repoRoot: "/project" });
    completions[1](null);
  });
  expect(view.hasRepo).toBeUndefined();
  await act(async () => completions[2](null));
  expect(view.hasRepo).toBe(false);
});
it("coalesces refresh events while retaining one fresh read after pending work", async () => {
  const completions: ((value: object | null) => void)[] = [];
  resolveRepo.mockImplementation(
    () => new Promise((resolve) => completions.push(resolve)),
  );
  await act(async () => root.render(<Probe />));
  await act(async () => {
    for (let index = 0; index < 20; index++)
      window.dispatchEvent(new CustomEvent("voktty:git-refresh"));
  });
  expect(resolveRepo).toHaveBeenCalledTimes(1);
  await act(async () => completions[0]({ repoRoot: "/project" }));
  expect(resolveRepo).toHaveBeenCalledTimes(2);
  expect(view.hasRepo).toBeUndefined();
  await act(async () => completions[1](null));
  expect(view.hasRepo).toBe(false);
});
it("retires cached refresh callbacks and subscriptions on unmount", async () => {
  await act(async () => root.render(<Probe />));
  const refresh = view.refresh;
  await act(async () => root.render(null));
  await act(async () => {
    refresh();
    window.dispatchEvent(new CustomEvent("voktty:git-refresh"));
  });
  expect(resolveRepo).toHaveBeenCalledTimes(1);
});

it("does not redirect an old refresh callback to the successor root", async () => {
  await act(async () => root.render(<Probe path="/old" />));
  const refresh = view.refresh;
  await act(async () => root.render(<Probe path="/current" />));
  await act(async () => refresh());
  expect(resolveRepo).toHaveBeenCalledTimes(2);
  expect(view.hasRepo).toBe(false);
});
it("keeps errors unknown and retries through explicit refresh", async () => {
  resolveRepo.mockRejectedValue(new Error("Unavailable"));
  await act(async () => root.render(<Probe />));
  expect(view.hasRepo).toBeUndefined();
  expect(view.status).toBe("error");
  resolveRepo.mockResolvedValue(null);
  await act(async () => view.refresh());
  expect(view.hasRepo).toBe(false);
  expect(view.status).toBe("ready");
});

it("publishes loading while refreshing instead of reusing a previous absence", async () => {
  await act(async () => root.render(<Probe />));
  expect(view.status).toBe("ready");
  let complete!: (value: null) => void;
  resolveRepo.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await act(async () => view.refresh());
  expect(view.status).toBe("loading");
  expect(view.hasRepo).toBeUndefined();
  await act(async () => complete(null));
  expect(view.status).toBe("ready");
});
it.each([
  "C:/project",
  "//server/share/project",
  "remote://voktty-ssh-build/project",
])("preserves the explicit target %s", async (path) => {
  await act(async () => root.render(<Probe path={path} />));
  expect(resolveRepo).toHaveBeenCalledExactlyOnceWith(path, local);
});
it.each<WorkspaceEnv>([
  { kind: "serial", portName: "port", baudRate: 9600 },
  {
    kind: "docker",
    connection: { containerId: "box", containerName: "Box", image: "image" },
  },
])("does not resolve unsupported $kind targets locally", async (workspace) => {
  await act(async () => root.render(<Probe workspace={workspace} />));
  expect(view.hasRepo).toBeUndefined();
  expect(resolveRepo).not.toHaveBeenCalled();
});
it("rejects unknown remote namespaces without native reads", async () => {
  await act(async () => root.render(<Probe path="remote://unknown/project" />));
  expect(resolveRepo).not.toHaveBeenCalled();
});

it("counts retired reads and retries the current root after capacity returns", async () => {
  const completions: ((value: object | null) => void)[] = [];
  resolveRepo.mockImplementation(
    () => new Promise((resolve) => completions.push(resolve)),
  );
  for (let index = 0; index <= 256; index++) {
    await act(async () => root.render(<Probe path={`/root-${index}`} />));
  }
  expect(resolveRepo).toHaveBeenCalledTimes(256);
  await act(async () => completions[0](null));
  expect(resolveRepo).toHaveBeenCalledTimes(257);
  expect(resolveRepo).toHaveBeenLastCalledWith("/root-256", local);
  expect(view.hasRepo).toBeUndefined();
  await act(async () => {
    for (const done of completions.slice(1)) done(null);
  });
  expect(view.hasRepo).toBe(false);
});
