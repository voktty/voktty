// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useSourceControlContext } from "@/modules/source-control/useSourceControlContext";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { EditorTab, Tab } from "@/modules/tabs/lib/useTabs";
import { LOCAL_WORKSPACE, useWorkspaceEnvStore } from "@/modules/workspace";

const { resolve, info, error } = vi.hoisted(() => ({
  resolve: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitResolveRepo: resolve },
}));
vi.mock("sonner", () => ({ toast: { info, error } }));
vi.mock("@/modules/source-control/useSourceControl", () => ({
  useSourceControl: () => ({
    hasRepo: true,
    contextPath: "/explorer",
    repo: { repoRoot: "/explorer", branch: "wrong" },
    status: { branch: "wrong" },
  }),
}));

const originalWorkspace = useWorkspaceEnvStore.getState().env;
afterEach(() => {
  useWorkspaceEnvStore.setState({ env: originalWorkspace });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const no = () => {};
function editor(path = "/project/main.ts"): EditorTab {
  return {
    id: 1,
    ...createTabIdentity("main"),
    spaceId: "main",
    kind: "editor",
    title: "Document",
    path,
    dirty: false,
    preview: false,
    workspaceEnv: LOCAL_WORKSPACE,
  };
}
async function setup(tab: Tab = editor()) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  resolve.mockReset();
  resolve.mockResolvedValue({ repoRoot: "/project", branch: "main" });
  const input = {
    activeTab: tab as Tab | undefined,
    tabs: [tab],
    activeTerminalLeafCwd: null as string | null,
    explorerRoot: "/explorer",
    launchCwd: "/fallback",
    launchCwdResolved: true,
    home: "/home",
    sidebarView: "explorer" as "explorer" | "source-control",
    explorerGitDecorations: true,
    repositoryTarget: { mode: "follow-context" } as
      | { mode: "follow-context" }
      | { mode: "fixed"; repoRoot: string },
    cycleSidebarView: no,
    openCommitHistoryTab: vi.fn(),
  };
  let output!: ReturnType<typeof useSourceControlContext>;
  function Listener() {
    output = useSourceControlContext(input);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = () => act(async () => root.render(<Listener />));
  await render();
  return {
    input,
    output: () => output,
    render,
    close: () => act(async () => root.unmount()),
  };
}
function deferred() {
  let finish!: (value: { repoRoot: string; branch: string } | null) => void;
  let fail!: (reason: Error) => void;
  const promise = new Promise<{ repoRoot: string; branch: string } | null>(
    (yes, no) => {
      finish = yes;
      fail = no;
    },
  );
  return { promise, finish, fail };
}

it("resolves the document repository rather than adopting the explorer badge", async () => {
  const f = await setup();
  try {
    await f.output().openGitGraphFromContext();
    expect(resolve).toHaveBeenCalledExactlyOnceWith(
      "/project",
      LOCAL_WORKSPACE,
    );
    expect(f.input.openCommitHistoryTab).toHaveBeenCalledExactlyOnceWith({
      repoRoot: "/project",
      branch: "main",
      workspaceEnv: LOCAL_WORKSPACE,
    });
  } finally {
    await f.close();
  }
});

it("keeps Harness project identity separate from Explorer and the ambient WSL workspace", async () => {
  const f = await setup({
    id: 1,
    ...createTabIdentity("main"),
    spaceId: "main",
    title: "Harness",
    kind: "harness",
    cwd: "/harness",
  });
  try {
    await act(async () =>
      useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Debian" } }),
    );
    await f.output().openGitGraphFromContext();
    expect(resolve).toHaveBeenCalledExactlyOnceWith(
      "/harness",
      LOCAL_WORKSPACE,
    );
  } finally {
    await f.close();
  }
});

it("uses a document's captured WSL filesystem and native Windows path interpretation", async () => {
  const f = await setup({
    ...editor(),
    workspaceEnv: { kind: "wsl", distro: "Debian" },
  });
  try {
    await f.output().openGitGraphFromContext();
    expect(resolve).toHaveBeenLastCalledWith("/project", {
      kind: "wsl",
      distro: "Debian",
    });
    f.input.activeTab = {
      ...editor("C:\\project\\main.ts"),
      workspaceEnv: { kind: "wsl", distro: "Debian" },
    };
    await f.render();
    await f.output().openGitGraphFromContext();
    expect(resolve).toHaveBeenLastCalledWith("C:/project", LOCAL_WORKSPACE);
  } finally {
    await f.close();
  }
});

it("preserves a fixed Source Control target instead of the selected document", async () => {
  const f = await setup();
  try {
    f.input.sidebarView = "source-control";
    f.input.repositoryTarget = { mode: "fixed", repoRoot: "/fixed" };
    await f.render();
    await f.output().openGitGraphFromContext();
    expect(resolve).toHaveBeenCalledExactlyOnceWith("/fixed", LOCAL_WORKSPACE);
  } finally {
    await f.close();
  }
});

it.each(["success", "missing", "error"] as const)(
  "retires pending %s after leaving and returning to the source",
  async (outcome) => {
    const f = await setup();
    try {
      const pending = deferred();
      resolve.mockReturnValue(pending.promise);
      const cached = f.output().openGitGraphFromContext;
      const opening = cached();
      const original = f.input.activeTab;
      f.input.activeTab = editor("/other/main.ts");
      await f.render();
      f.input.activeTab = original;
      await f.render();
      if (outcome === "error") pending.fail(new Error("unavailable"));
      else
        pending.finish(
          outcome === "missing"
            ? null
            : { repoRoot: "/project", branch: "main" },
        );
      await opening;
      await cached();
      expect(f.input.openCommitHistoryTab).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(resolve).toHaveBeenCalledOnce();
    } finally {
      await f.close();
    }
  },
);

it("suppresses a pending opening and cached action after unmount", async () => {
  const f = await setup();
  const pending = deferred();
  resolve.mockReturnValue(pending.promise);
  const cached = f.output().openGitGraphFromContext;
  const opening = cached();
  await f.close();
  pending.finish({ repoRoot: "/project", branch: "main" });
  await opening;
  await cached();
  expect(f.input.openCommitHistoryTab).not.toHaveBeenCalled();
  expect(resolve).toHaveBeenCalledOnce();
});

it.each(["directory", "filesystem", "fixed-target"] as const)(
  "retires a pending opening after %s changes with the same tab identity",
  async (change) => {
    const tab = editor();
    const f = await setup(tab);
    try {
      const pending = deferred();
      resolve.mockReturnValue(pending.promise);
      const opening = f.output().openGitGraphFromContext();
      if (change === "directory")
        f.input.activeTab = { ...tab, path: "/other/main.ts" };
      else if (change === "filesystem")
        f.input.activeTab = {
          ...tab,
          workspaceEnv: { kind: "wsl", distro: "Debian" },
        };
      else {
        f.input.sidebarView = "source-control";
        f.input.repositoryTarget = { mode: "fixed", repoRoot: "/fixed" };
      }
      await f.render();
      f.input.activeTab = tab;
      f.input.sidebarView = "explorer";
      f.input.repositoryTarget = { mode: "follow-context" };
      await f.render();
      pending.finish({ repoRoot: "/project", branch: "main" });
      await opening;
      expect(f.input.openCommitHistoryTab).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  },
);

it("keeps a pending document opening through dirty metadata updates", async () => {
  const tab = editor();
  const f = await setup(tab);
  try {
    const pending = deferred();
    resolve.mockReturnValue(pending.promise);
    const opening = f.output().openGitGraphFromContext();
    f.input.activeTab = { ...tab, dirty: true };
    await f.render();
    pending.finish({ repoRoot: "/project", branch: "main" });
    await opening;
    expect(f.input.openCommitHistoryTab).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});

it("counts retired resolutions until their actual settlement", async () => {
  const tab = editor();
  const f = await setup(tab);
  try {
    const pending = deferred();
    resolve.mockReturnValue(pending.promise);
    const openings = Array.from({ length: 256 }, () =>
      f.output().openGitGraphFromContext(),
    );
    expect(resolve).toHaveBeenCalledTimes(256);
    f.input.activeTab = editor("/other/main.ts");
    await f.render();
    await f.output().openGitGraphFromContext();
    expect(resolve).toHaveBeenCalledTimes(256);
    pending.finish({ repoRoot: "/project", branch: "main" });
    await Promise.all(openings);
    expect(f.input.openCommitHistoryTab).not.toHaveBeenCalled();
    resolve.mockResolvedValue({ repoRoot: "/other", branch: "next" });
    await f.output().openGitGraphFromContext();
    expect(resolve).toHaveBeenCalledTimes(257);
    expect(f.input.openCommitHistoryTab).toHaveBeenCalledExactlyOnceWith({
      repoRoot: "/other",
      branch: "next",
      workspaceEnv: LOCAL_WORKSPACE,
    });
  } finally {
    await f.close();
  }
});

it("keeps namespaced remote projects remote and rejects serial or guest terminal fallbacks", async () => {
  const f = await setup(editor("remote://machine/project/main.ts"));
  try {
    await f.output().openGitGraphFromContext();
    expect(resolve).toHaveBeenLastCalledWith(
      "remote://machine/project",
      LOCAL_WORKSPACE,
    );
    const terminal: Tab = {
      id: 2,
      ...createTabIdentity("main"),
      spaceId: "main",
      title: "Serial",
      kind: "terminal",
      paneTree: { kind: "leaf", id: 10, cwd: "/serial" },
      activeLeafId: 10,
      workspaceEnv: { kind: "serial", portName: "COM1", baudRate: 9600 },
    };
    f.input.activeTab = terminal;
    await f.render();
    await f.output().openGitGraphFromContext();
    expect(resolve).toHaveBeenCalledOnce();
    f.input.activeTab = {
      ...terminal,
      workspaceEnv: LOCAL_WORKSPACE,
      collaboration: { mode: "guest" },
    };
    await f.render();
    await f.output().openGitGraphFromContext();
    expect(resolve).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});

it("uses the terminal's selected leaf and SSH filesystem", async () => {
  const workspace = {
    kind: "ssh" as const,
    connection: { id: "host", name: "Host", host: "example.test" },
    root: "/project",
    sessionId: 10,
  };
  const f = await setup({
    id: 2,
    ...createTabIdentity("main"),
    spaceId: "main",
    title: "SSH",
    kind: "terminal",
    paneTree: { kind: "leaf", id: 10, cwd: "/project/old" },
    activeLeafId: 10,
    workspaceEnv: workspace,
  });
  try {
    f.input.activeTerminalLeafCwd = "/project/current";
    await f.render();
    await f.output().openGitGraphFromContext();
    expect(resolve).toHaveBeenCalledExactlyOnceWith(
      "/project/current",
      workspace,
    );
    expect(f.input.openCommitHistoryTab).toHaveBeenCalledExactlyOnceWith({
      repoRoot: "/project",
      branch: "main",
      workspaceEnv: workspace,
    });
  } finally {
    await f.close();
  }
});

it.each(["missing", "error"] as const)(
  "reports a current %s without opening another repository",
  async (outcome) => {
    const f = await setup();
    try {
      if (outcome === "missing") resolve.mockResolvedValue(null);
      else resolve.mockRejectedValue(new Error("unavailable"));
      await f.output().openGitGraphFromContext();
      expect(f.input.openCommitHistoryTab).not.toHaveBeenCalled();
      expect(outcome === "missing" ? info : error).toHaveBeenCalledOnce();
    } finally {
      await f.close();
    }
  },
);
