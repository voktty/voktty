// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGitHistoryRequests } from "@/modules/source-control/useGitHistoryRequests";
import {
  GIT_HISTORY_EVENT,
  useGitHistoryRequest,
} from "@/modules/source-control/gitHistoryRequest";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import { GitCommitDiffPane } from "@/modules/git-history/GitCommitDiffPane";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitResolveRepo: mocks.resolve, gitCommitFiles: async () => [] },
}));
vi.mock("sonner", () => ({ toast: { info: mocks.info, error: mocks.error } }));
const open = vi.fn();
let root: Root;
let node: HTMLDivElement;
let send: () => boolean;
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/repo",
  connection: { id: "build", name: "Build", host: "build.example" },
};
let params: {
  sourceKey: string;
  path: string;
  workspace: WorkspaceEnv;
  sender: boolean;
};
function Sender({
  path,
  workspace,
}: Pick<typeof params, "path" | "workspace">) {
  send = useGitHistoryRequest({
    repoRoot: path,
    branch: "feature",
    workspaceEnv: workspace,
  });
  return null;
}
function Probe({ sourceKey, path, workspace, sender }: typeof params) {
  useGitHistoryRequests({ spaceId: "main", sourceKey, open });
  return sender ? <Sender path={path} workspace={workspace} /> : null;
}
async function render() {
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe {...params} />
      </StrictMode>,
    ),
  );
}
function deferred() {
  let resolve!: (value: { repoRoot: string } | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ repoRoot: string } | null>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.resolve.mockReset().mockResolvedValue({ repoRoot: "/repo" });
  mocks.info.mockClear();
  mocks.error.mockClear();
  open.mockClear();
  params = {
    sourceKey: "owner",
    path: "/repo/subdir",
    workspace: LOCAL_WORKSPACE,
    sender: true,
  };
  useSpaces.setState({
    activeId: "main",
    spaces: [
      {
        id: "main",
        name: "Main",
        root: "/ambient",
        env: ssh,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it.each<WorkspaceEnv>([
  LOCAL_WORKSPACE,
  ssh,
  { kind: "wsl", distro: "Ubuntu" },
])(
  "resolves the requested subdirectory with its own filesystem",
  async (workspace) => {
    params.workspace = workspace;
    await render();
    await act(async () => {
      expect(send()).toBe(true);
    });
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
      "/repo/subdir",
      workspace,
    );
    expect(open).toHaveBeenCalledExactlyOnceWith({
      repoRoot: "/repo",
      branch: "feature",
      workspaceEnv: workspace,
      spaceId: "main",
    });
  },
);
it.each(["source", "sender", "filesystem", "unmount", "space"])(
  "retires pending delivery after %s changes, including a return",
  async (change) => {
    const pending = deferred();
    mocks.resolve.mockReturnValue(pending.promise);
    await render();
    await act(async () => {
      send();
    });
    if (change === "source") {
      params.sourceKey = "other";
      await render();
      params.sourceKey = "owner";
      await render();
    }
    if (change === "sender") {
      params.path = "/other";
      await render();
      params.path = "/repo/subdir";
      await render();
    }
    if (change === "filesystem") {
      params.workspace = ssh;
      await render();
      params.workspace = LOCAL_WORKSPACE;
      await render();
    }
    if (change === "unmount") {
      params.sender = false;
      await render();
      params.sender = true;
      await render();
    }
    if (change === "space") {
      useSpaces.setState({ activeId: "other" });
      useSpaces.setState({ activeId: "main" });
    }
    await act(async () => pending.resolve({ repoRoot: "/repo" }));
    expect(open).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  },
);
it("refuses unqualified and replayed event payloads", async () => {
  await render();
  let captured: unknown;
  const capture = (event: Event) => {
    captured = (event as CustomEvent).detail;
  };
  window.addEventListener(GIT_HISTORY_EVENT, capture);
  try {
    await act(async () => {
      send();
    });
  } finally {
    window.removeEventListener(GIT_HISTORY_EVENT, capture);
  }
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => {
    for (const detail of [undefined, {}, { repoRoot: "/wrong" }, captured])
      window.dispatchEvent(new CustomEvent(GIT_HISTORY_EVENT, { detail }));
  });
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
});
it("retains the physical request budget across context retirement", async () => {
  const pending = deferred();
  mocks.resolve.mockReturnValue(pending.promise);
  await render();
  await act(async () => {
    for (let i = 0; i < 256; i++) send();
  });
  params.sourceKey = "other";
  await render();
  await act(async () => {
    send();
  });
  expect(mocks.resolve).toHaveBeenCalledTimes(256);
  await act(async () => pending.resolve({ repoRoot: "/repo" }));
  expect(open).not.toHaveBeenCalled();
  mocks.resolve.mockResolvedValue({ repoRoot: "/repo" });
  await act(async () => {
    send();
  });
  expect(open).toHaveBeenCalledTimes(1);
});

it("consumes a receipt before a listener can replay it reentrantly", async () => {
  await render();
  let replayed = false;
  const replay = (event: Event) => {
    if (replayed) return;
    replayed = true;
    window.dispatchEvent(
      new CustomEvent(GIT_HISTORY_EVENT, {
        detail: (event as CustomEvent).detail,
      }),
    );
  };
  window.addEventListener(GIT_HISTORY_EVENT, replay);
  try {
    await act(async () => {
      send();
    });
  } finally {
    window.removeEventListener(GIT_HISTORY_EVENT, replay);
  }
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
});
it("reports current errors and missing repositories without falling back", async () => {
  await render();
  mocks.resolve.mockResolvedValue(null);
  await act(async () => {
    send();
  });
  expect(mocks.info).toHaveBeenCalledTimes(1);
  mocks.resolve.mockRejectedValue(new Error("lookup failed"));
  await act(async () => {
    send();
  });
  expect(mocks.error).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
});

it("suppresses an error from a retired sender and refuses its cached callback", async () => {
  const pending = deferred();
  mocks.resolve.mockReturnValue(pending.promise);
  await render();
  const oldSend = send;
  await act(async () => {
    send();
  });
  params.sender = false;
  await render();
  expect(oldSend()).toBe(false);
  await act(async () => pending.reject(new Error("retired lookup")));
  expect(open).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});

it.each(["", "   ", "bad\npath", "x".repeat(32769)])(
  "rejects an invalid explicit root without IO",
  async (path) => {
    params.path = path;
    await render();
    expect(send()).toBe(false);
    expect(mocks.resolve).not.toHaveBeenCalled();
  },
);

it("routes the commit pane fallback through repository resolution", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe {...params} sender={false} />
        <GitCommitDiffPane
          repoRoot="/repo/subdir"
          sha="abc"
          shortSha="abc"
          subject="Commit"
          workspaceEnv={ssh}
        />
      </StrictMode>,
    ),
  );
  await act(async () => node.querySelector("button")?.click());
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith("/repo/subdir", ssh);
  expect(open).toHaveBeenCalledExactlyOnceWith({
    repoRoot: "/repo",
    workspaceEnv: ssh,
    branch: undefined,
    spaceId: "main",
  });
});

it("preserves the commit pane's explicit history callback", async () => {
  const callback = vi.fn();
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe {...params} sender={false} />
        <GitCommitDiffPane
          repoRoot="/repo"
          sha="abc"
          shortSha="abc"
          subject="Commit"
          workspaceEnv={ssh}
          onOpenCommitHistory={callback}
        />
      </StrictMode>,
    ),
  );
  await act(async () => node.querySelector("button")?.click());
  expect(callback).toHaveBeenCalledExactlyOnceWith({
    repoRoot: "/repo",
    workspaceEnv: ssh,
  });
  expect(mocks.resolve).not.toHaveBeenCalled();
});
