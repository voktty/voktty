// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGitStatus } from "@/modules/explorer/lib/useGitStatus";
import type { GitStatusSnapshot } from "@/modules/ai/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: io }));
vi.mock("@/modules/ai/lib/native", () => ({ native: { canonicalize: io } }));
const local: WorkspaceEnv = { kind: "local" };
let root: Root;
let view: ReturnType<typeof useGitStatus>;
const status: GitStatusSnapshot = {
  repoRoot: "/repo",
  branch: "main",
  upstream: null,
  ahead: 0,
  behind: 0,
  isDetached: false,
  truncated: false,
  changedFiles: [
    {
      path: "a.ts",
      originalPath: null,
      indexStatus: " ",
      worktreeStatus: "M",
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      statusLabel: "Modified",
    },
  ],
};
function Probe({
  path = "/repo",
  workspace = local,
  owner = local,
  snapshot = status,
  enabled = true,
}: {
  path?: string;
  workspace?: WorkspaceEnv;
  owner?: WorkspaceEnv;
  snapshot?: GitStatusSnapshot;
  enabled?: boolean;
}) {
  view = useGitStatus(path, snapshot, enabled, workspace, owner);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  io.mockReset().mockResolvedValue("/repo");
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("canonicalizes with the explicitly owned WSL filesystem", async () => {
  const workspace: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
  await act(async () =>
    root.render(<Probe workspace={workspace} owner={workspace} />),
  );
  expect(io).toHaveBeenCalledExactlyOnceWith("fs_canonicalize", {
    path: "/repo",
    workspace,
  });
  expect(view.lookup("/repo/a.ts")).toBe("M");
});

it("does not repeat canonicalization for equivalent filesystem publications", async () => {
  await act(async () => root.render(<Probe workspace={{ kind: "local" }} />));
  await act(async () => root.render(<Probe workspace={{ kind: "local" }} />));
  expect(io).toHaveBeenCalledTimes(1);
});

it("never decorates a same-path snapshot from a different filesystem", async () => {
  await act(async () =>
    root.render(<Probe workspace={{ kind: "wsl", distro: "Ubuntu" }} />),
  );
  expect(view.lookup("/repo/a.ts")).toBeNull();
  expect(io).not.toHaveBeenCalled();
});

it("does not interpret a parent-root file as a child repository change", async () => {
  io.mockResolvedValue("/parent");
  await act(async () =>
    root.render(
      <Probe
        path="/parent"
        snapshot={{ ...status, repoRoot: "/parent/repo" }}
      />,
    ),
  );
  expect(view.lookup("/parent/a.ts")).toBeNull();
  expect(view.lookup("/parent/repo/a.ts")).toBe("M");
});

it("rebases symlink aliases through their canonical subdirectory", async () => {
  io.mockResolvedValue("/repo/src");
  await act(async () =>
    root.render(
      <Probe
        path="/link"
        snapshot={{
          ...status,
          changedFiles: [{ ...status.changedFiles[0], path: "src/a.ts" }],
        }}
      />,
    ),
  );
  expect(view.lookup("/link/a.ts")).toBe("M");
});

it("retires a pending alias when decorations are disabled", async () => {
  let done!: (path: string) => void;
  io.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        done = resolve;
      }),
  );
  await act(async () => root.render(<Probe path="/old" />));
  await act(async () => root.render(<Probe path="/new" enabled={false} />));
  await act(async () => {
    done("/repo");
  });
  await act(async () => root.render(<Probe path="/new" />));
  expect(view.lookup("/new/a.ts")).toBeNull();
});

it.each<WorkspaceEnv>([
  {
    kind: "ssh",
    root: "/repo",
    sessionId: 9,
    connection: { id: "build", name: "Build", host: "build.example" },
  },
  {
    kind: "docker",
    connection: { containerId: "box", containerName: "Box", image: "image" },
  },
  { kind: "serial", portName: "port", baudRate: 9600 },
])("does not canonicalize a $kind root on this computer", async (workspace) => {
  await act(async () =>
    root.render(<Probe workspace={workspace} owner={workspace} />),
  );
  expect(io).not.toHaveBeenCalled();
});

it("keeps repository-root status working at the POSIX filesystem root", async () => {
  io.mockResolvedValue("/");
  await act(async () =>
    root.render(<Probe path="/" snapshot={{ ...status, repoRoot: "/" }} />),
  );
  expect(view.lookup("/a.ts")).toBe("M");
});

it.each([
  "remote://voktty-ssh-build/repo",
  "remote://unknown/repo",
  "relative",
])("never sends %s to native canonicalization", async (path) => {
  await act(async () =>
    root.render(<Probe path={path} snapshot={{ ...status, repoRoot: path }} />),
  );
  expect(io).not.toHaveBeenCalled();
});

it("distinguishes SSH hosts with the same saved profile ID and root", async () => {
  const owner: WorkspaceEnv = {
    kind: "ssh",
    root: "/repo",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  };
  const workspace: WorkspaceEnv = {
    ...owner,
    connection: { ...owner.connection, host: "other.example" },
  };
  await act(async () =>
    root.render(<Probe workspace={workspace} owner={owner} />),
  );
  expect(view.lookup("/repo/a.ts")).toBeNull();
  expect(io).not.toHaveBeenCalled();
});

it("retains retired canonicalizations within its bounded unsettled budget", async () => {
  const completions: ((path: string) => void)[] = [];
  io.mockImplementation(
    () => new Promise<string>((resolve) => completions.push(resolve)),
  );
  for (let index = 0; index <= 256; index++) {
    await act(async () => root.render(<Probe path={`/root-${index}`} />));
  }
  expect(io).toHaveBeenCalledTimes(256);
  await act(async () => {
    for (const done of completions) done("/repo");
  });
  expect(view.lookup("/root-256/a.ts")).toBeNull();
  io.mockResolvedValue("/repo");
  await act(async () => root.render(<Probe path="/retry" />));
  expect(io).toHaveBeenCalledTimes(257);
  expect(view.lookup("/retry/a.ts")).toBe("M");
});
