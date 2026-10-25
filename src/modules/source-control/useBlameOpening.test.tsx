// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBlameOpening } from "@/modules/source-control/useBlameOpening";
import type { WorkspaceEnv } from "@/modules/workspace";

const resolveRepo = vi.hoisted(() => vi.fn());
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitResolveRepo: resolveRepo },
}));
let root: Root;
let run: ReturnType<typeof useBlameOpening>;
const open = vi.fn();
const missing = vi.fn();
const error = vi.fn();
const local: WorkspaceEnv = { kind: "local" };
const scope = {};
function Probe({
  workspace = local,
  owner = scope,
}: {
  workspace?: WorkspaceEnv;
  owner?: object;
}) {
  run = useBlameOpening({
    scope: owner,
    workspace,
    open,
    onMissing: missing,
    onError: error,
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resolveRepo.mockReset().mockResolvedValue({ repoRoot: "/repo" });
  open.mockReset();
  missing.mockReset();
  error.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it.each<WorkspaceEnv>([
  local,
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "ssh",
    root: "/repo",
    sessionId: 9,
    connection: { id: "build", name: "Build", host: "build.example" },
  },
])(
  "preserves the $kind file target through repository resolution",
  async (workspace) => {
    await act(async () => root.render(<Probe workspace={workspace} />));
    await act(async () => run("/repo/a.ts"));
    expect(resolveRepo).toHaveBeenCalledExactlyOnceWith(
      "/repo/a.ts",
      workspace,
    );
    expect(open).toHaveBeenCalledExactlyOnceWith({
      repoRoot: "/repo",
      path: "/repo/a.ts",
      workspace,
    });
    expect(open.mock.calls[0][0].workspace).not.toBe(workspace);
  },
);
it("rejects native-unsupported namespaces before IO", async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => run("remote://voktty-ssh-build/repo/a.ts"));
  expect(resolveRepo).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});
it("retires results and cached calls after the original view changes", async () => {
  let done!: (value: object) => void;
  resolveRepo.mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  await act(async () => root.render(<Probe />));
  const old = run;
  let pending!: Promise<void>;
  await act(async () => {
    pending = old("/repo/a.ts");
  });
  await act(async () => root.render(<Probe owner={{}} />));
  await act(async () => {
    done({ repoRoot: "/repo" });
    await pending;
    await old("/repo/b.ts");
  });
  expect(resolveRepo).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
});
it("only opens the latest accepted request in the same view", async () => {
  const completions: ((value: object) => void)[] = [];
  resolveRepo.mockImplementation(
    () => new Promise((resolve) => completions.push(resolve)),
  );
  await act(async () => root.render(<Probe />));
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = run("/repo/a.ts");
    second = run("/repo/b.ts");
  });
  await act(async () => {
    completions[1]({ repoRoot: "/repo" });
    await second;
    completions[0]({ repoRoot: "/repo" });
    await first;
  });
  expect(open).toHaveBeenCalledExactlyOnceWith({
    repoRoot: "/repo",
    path: "/repo/b.ts",
    workspace: local,
  });
});

it("preserves current missing-repository and native-error feedback", async () => {
  await act(async () => root.render(<Probe />));
  resolveRepo.mockResolvedValueOnce(null);
  await act(async () => run("/repo/a.ts"));
  expect(missing).toHaveBeenCalledOnce();
  const reason = new Error("Native failure");
  resolveRepo.mockRejectedValueOnce(reason);
  await act(async () => run("/repo/a.ts"));
  expect(error).toHaveBeenCalledExactlyOnceWith(reason);
  expect(open).not.toHaveBeenCalled();
});

it("retains retired native resolutions within its bounded budget", async () => {
  const completions: ((value: object) => void)[] = [];
  const operations: Promise<void>[] = [];
  resolveRepo.mockImplementation(
    () => new Promise((resolve) => completions.push(resolve)),
  );
  for (let index = 0; index <= 256; index++) {
    await act(async () => root.render(<Probe owner={{ index }} />));
    await act(async () => {
      operations.push(run("/repo/a.ts"));
    });
  }
  expect(resolveRepo).toHaveBeenCalledTimes(256);
  await act(async () => {
    for (const done of completions) done({ repoRoot: "/repo" });
    await Promise.all(operations);
  });
  expect(open).not.toHaveBeenCalled();
  resolveRepo.mockResolvedValue({ repoRoot: "/repo" });
  await act(async () => run("/repo/a.ts"));
  expect(resolveRepo).toHaveBeenCalledTimes(257);
  expect(open).toHaveBeenCalledOnce();
});

it.each<WorkspaceEnv>([
  { kind: "serial", portName: "port", baudRate: 9600 },
  {
    kind: "docker",
    connection: { containerId: "box", containerName: "Box", image: "image" },
  },
])(
  "refuses unsupported $kind reads without local fallback",
  async (workspace) => {
    await act(async () => root.render(<Probe workspace={workspace} />));
    await act(async () => run("/repo/a.ts"));
    expect(resolveRepo).not.toHaveBeenCalled();
  },
);

it.each(["C:/repo/a.ts", "//server/share/repo/a.ts"])(
  "preserves native Windows and UNC targets: %s",
  async (path) => {
    await act(async () => root.render(<Probe />));
    await act(async () => run(path));
    expect(resolveRepo).toHaveBeenCalledExactlyOnceWith(path, local);
  },
);
