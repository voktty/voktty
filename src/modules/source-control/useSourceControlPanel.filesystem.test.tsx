// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSourceControlPanel } from "@/modules/source-control/useSourceControlPanel";
import type { SourceControlSummary } from "@/modules/source-control/useSourceControl";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  stage: vi.fn(),
  unstage: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    gitStage: mocks.stage,
    gitUnstage: mocks.unstage,
    gitDiscard: mocks.discard,
  },
}));
let root: Root;
let panel: ReturnType<typeof useSourceControlPanel>;
const previousEnv = useWorkspaceEnvStore.getState().env;
const environments: WorkspaceEnv[] = [
  { kind: "local" },
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "ssh",
    root: "/project",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  },
  {
    kind: "docker",
    connection: {
      containerId: "container",
      containerName: "Build",
      image: "dev",
    },
  },
];
function summary(staged: boolean): SourceControlSummary {
  return {
    contextPath: "/project",
    repo: {
      repoRoot: "/project",
      branch: "main",
      upstream: null,
      isDetached: false,
    },
    status: {
      repoRoot: "/project",
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: [
        {
          path: "src/file.ts",
          originalPath: null,
          indexStatus: staged ? "M" : " ",
          worktreeStatus: staged ? " " : "M",
          staged,
          unstaged: !staged,
          untracked: false,
          conflicted: false,
          statusLabel: "Modified",
        },
      ],
    },
    changedCount: 1,
    upstream: null,
    ahead: 0,
    behind: 0,
    hasRepo: true,
    isLoading: false,
    localError: null,
    dubiousOwnershipPath: null,
    busyAction: null,
    lastRemoteError: null,
    applyStatus: vi.fn(),
    refresh: vi.fn(async () => {}),
    trustRepository: vi.fn(async () => {}),
    initRepository: vi.fn(async () => {}),
    undoCommit: vi.fn(async () => true),
    runRemoteAction: vi.fn(async () => ({ ok: false, action: null })),
  };
}
function Probe({
  value,
  open = true,
  dirty = [],
}: {
  value: SourceControlSummary;
  open?: boolean;
  dirty?: string[];
}) {
  panel = useSourceControlPanel(open, value, null, dirty);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.stage.mockReset().mockResolvedValue(undefined);
  mocks.unstage.mockReset().mockResolvedValue(undefined);
  mocks.discard.mockReset().mockResolvedValue(undefined);
  root = createRoot(document.createElement("div"));
});
it.each(["entry", "file", "all"])(
  "keeps a current %s discard on its original SSH filesystem",
  async (mode) => {
    const value = summary(false);
    useWorkspaceEnvStore.setState({ env: environments[2] });
    await act(async () => root.render(<Probe value={value} />));
    await act(async () => {
      if (mode === "entry") panel.requestDiscardEntry(panel.unstagedEntries[0]);
      else if (mode === "file") panel.requestDiscardFile(panel.fileEntries[0]);
      else panel.requestDiscardAll();
    });
    expect(panel.pendingDiscard?.count).toBe(1);
    await act(async () => panel.confirmPendingDiscard());
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith(
      "/project",
      [{ path: "src/file.ts", untracked: false }],
      environments[2],
    );
  },
);
it.each(["repo", "filesystem", "closed"])(
  "retires a discard dialog after its %s changes",
  async (change) => {
    const value = summary(false);
    useWorkspaceEnvStore.setState({ env: environments[0] });
    await act(async () => root.render(<Probe value={value} />));
    await act(async () => panel.requestDiscardAll());
    const oldConfirm = panel.confirmPendingDiscard;
    if (!value.repo || !value.status)
      throw new Error("Expected repository fixture");
    const next =
      change === "repo"
        ? {
            ...value,
            contextPath: "/other",
            repo: { ...value.repo, repoRoot: "/other" },
            status: { ...value.status, repoRoot: "/other" },
          }
        : value;
    await act(async () => {
      if (change === "filesystem")
        useWorkspaceEnvStore.setState({ env: environments[2] });
      root.render(<Probe value={next} open={change !== "closed"} />);
    });
    expect(panel.pendingDiscard).toBeNull();
    await act(async () => {
      await oldConfirm();
      await panel.confirmPendingDiscard();
    });
    expect(mocks.discard).not.toHaveBeenCalled();
  },
);
it("does not revive an old confirmation after a batched filesystem round trip", async () => {
  const value = summary(false);
  useWorkspaceEnvStore.setState({ env: environments[0] });
  await act(async () => root.render(<Probe value={value} />));
  await act(async () => panel.requestDiscardAll());
  const confirm = panel.confirmPendingDiscard;
  await act(async () => {
    useWorkspaceEnvStore.setState({ env: environments[2] });
    useWorkspaceEnvStore.setState({ env: environments[0] });
    await confirm();
  });
  expect(mocks.discard).not.toHaveBeenCalled();
  expect(panel.pendingDiscard).toBeNull();
  await act(async () => panel.requestDiscardAll());
  await act(async () => panel.confirmPendingDiscard());
  expect(mocks.discard).toHaveBeenCalledTimes(1);
});
it("consumes a confirmation before duplicate cached delivery", async () => {
  await act(async () => root.render(<Probe value={summary(false)} />));
  await act(async () => panel.requestDiscardAll());
  const confirm = panel.confirmPendingDiscard;
  await act(async () => {
    await Promise.all([confirm(), confirm()]);
  });
  expect(mocks.discard).toHaveBeenCalledTimes(1);
});
it("keeps a successor dialog when an older cancel or confirm is delivered", async () => {
  await act(async () => root.render(<Probe value={summary(false)} />));
  await act(async () => panel.requestDiscardAll());
  const old = panel;
  await act(async () => panel.cancelPendingDiscard());
  await act(async () => panel.requestDiscardAll());
  await act(async () => {
    old.cancelPendingDiscard();
    await old.confirmPendingDiscard();
  });
  expect(panel.pendingDiscard?.count).toBe(1);
  expect(mocks.discard).not.toHaveBeenCalled();
  await act(async () => panel.confirmPendingDiscard());
  expect(mocks.discard).toHaveBeenCalledTimes(1);
});
it("checks dirty buffers again while confirmation is open", async () => {
  const value = summary(false);
  await act(async () => root.render(<Probe value={value} />));
  await act(async () => panel.requestDiscardAll());
  await act(async () =>
    root.render(<Probe value={value} dirty={["/project/src/file.ts"]} />),
  );
  await act(async () => panel.confirmPendingDiscard());
  expect(mocks.discard).not.toHaveBeenCalled();
  expect(panel.actionError).toContain("src/file.ts");
});
it("uses current dirty buffers even for a cached confirmation", async () => {
  const value = summary(false);
  await act(async () => root.render(<Probe value={value} />));
  await act(async () => panel.requestDiscardAll());
  const confirm = panel.confirmPendingDiscard;
  await act(async () =>
    root.render(<Probe value={value} dirty={["/project/src/file.ts"]} />),
  );
  await act(async () => confirm());
  expect(mocks.discard).not.toHaveBeenCalled();
});
it("rejects confirmation and dialog requests from an unmounted owner", async () => {
  await act(async () => root.render(<Probe value={summary(false)} />));
  await act(async () => panel.requestDiscardAll());
  const old = panel;
  await act(async () => root.render(null));
  await act(async () => {
    await old.confirmPendingDiscard();
    old.requestDiscardAll();
  });
  expect(mocks.discard).not.toHaveBeenCalled();
});
it("copies the entry before publishing its confirmation", async () => {
  await act(async () => root.render(<Probe value={summary(false)} />));
  const entry = { ...panel.unstagedEntries[0] };
  await act(async () => panel.requestDiscardEntry(entry));
  entry.path = "another.ts";
  entry.untracked = true;
  await act(async () => panel.confirmPendingDiscard());
  expect(mocks.discard).toHaveBeenCalledExactlyOnceWith(
    "/project",
    [{ path: "src/file.ts", untracked: false }],
    expect.anything(),
  );
});
it.each([false, true])(
  "suppresses retired discard settlement (reject=%s)",
  async (reject) => {
    let resolve!: () => void;
    let fail!: (error: Error) => void;
    mocks.discard.mockImplementation(
      () =>
        new Promise<void>((done, error) => {
          resolve = done;
          fail = error;
        }),
    );
    const value = summary(false);
    await act(async () => root.render(<Probe value={value} />));
    await act(async () => panel.requestDiscardAll());
    let operation!: Promise<void>;
    await act(async () => {
      operation = panel.confirmPendingDiscard();
    });
    expect(panel.actionBusy).toBe("discard:all");
    await act(async () => root.render(<Probe value={value} open={false} />));
    expect(panel.actionBusy).toBeNull();
    await act(async () => {
      if (reject) fail(new Error("Old discard failed"));
      else resolve();
      await operation;
    });
    expect(panel.actionError).toBeNull();
    expect(value.refresh).not.toHaveBeenCalled();
  },
);
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  useWorkspaceEnvStore.setState({ env: previousEnv });
  vi.unstubAllGlobals();
});
it.each([false, true])(
  "reconciles successful discard only while its owner stays current (retire=%s)",
  async (retire) => {
    vi.useFakeTimers();
    const value = summary(false);
    await act(async () => root.render(<Probe value={value} />));
    await act(async () => panel.requestDiscardAll());
    await act(async () => panel.confirmPendingDiscard());
    if (retire)
      await act(async () => root.render(<Probe value={value} open={false} />));
    await act(async () => {
      vi.advanceTimersByTime(180);
    });
    expect(value.refresh).toHaveBeenCalledTimes(retire ? 0 : 1);
  },
);
it("keeps a successor discard busy while an older native operation settles", async () => {
  const completions: (() => void)[] = [];
  mocks.discard.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        completions.push(resolve);
      }),
  );
  const value = summary(false);
  await act(async () => root.render(<Probe value={value} />));
  await act(async () => panel.requestDiscardAll());
  let old!: Promise<void>;
  await act(async () => {
    old = panel.confirmPendingDiscard();
  });
  await act(async () => panel.requestDiscardAll());
  expect(panel.pendingDiscard).toBeNull();
  await act(async () => root.render(<Probe value={value} open={false} />));
  await act(async () => root.render(<Probe value={value} />));
  await act(async () => panel.requestDiscardAll());
  let next!: Promise<void>;
  await act(async () => {
    next = panel.confirmPendingDiscard();
  });
  expect(mocks.discard).toHaveBeenCalledTimes(2);
  await act(async () => {
    completions[0]();
    await old;
  });
  expect(panel.actionBusy).toBe("discard:all");
  await act(async () => {
    completions[1]();
    await next;
  });
  expect(panel.actionBusy).toBeNull();
});
it.each(environments)(
  "routes file checkbox staging through $kind",
  async (env) => {
    useWorkspaceEnvStore.setState({ env });
    await act(async () => root.render(<Probe value={summary(false)} />));
    await act(async () => panel.toggleStageFile(panel.fileEntries[0]));
    expect(mocks.stage).toHaveBeenCalledExactlyOnceWith(
      "/project",
      ["src/file.ts"],
      env,
    );
    expect(mocks.unstage).not.toHaveBeenCalled();
  },
);
it.each(environments)(
  "routes file checkbox unstaging through $kind",
  async (env) => {
    useWorkspaceEnvStore.setState({ env });
    await act(async () => root.render(<Probe value={summary(true)} />));
    await act(async () => panel.toggleStageFile(panel.fileEntries[0]));
    expect(mocks.unstage).toHaveBeenCalledExactlyOnceWith(
      "/project",
      ["src/file.ts"],
      env,
    );
    expect(mocks.stage).not.toHaveBeenCalled();
  },
);
it("refreshes the checkbox destination when only the filesystem changes", async () => {
  const value = summary(false);
  useWorkspaceEnvStore.setState({ env: environments[0] });
  await act(async () => root.render(<Probe value={value} />));
  await act(async () => panel.toggleStageFile(panel.fileEntries[0]));
  await act(async () =>
    useWorkspaceEnvStore.setState({ env: environments[2] }),
  );
  await act(async () => panel.toggleStageFile(panel.fileEntries[0]));
  expect(mocks.stage).toHaveBeenLastCalledWith(
    "/project",
    ["src/file.ts"],
    environments[2],
  );
  expect(mocks.stage).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
  "publishes undo success only for a positive acknowledgement (%s)",
  async (accepted) => {
    const value = summary(false);
    value.undoCommit = vi.fn(async () => accepted);
    await act(async () => root.render(<Probe value={value} />));
    await act(async () => panel.undoCommit());
    expect(value.undoCommit).toHaveBeenCalledTimes(1);
    if (accepted) expect(panel.actionMessage).toBeTruthy();
    else expect(panel.actionMessage).toBeNull();
  },
);
it("does not call undo through a cached closed-panel callback", async () => {
  const value = summary(false);
  await act(async () => root.render(<Probe value={value} />));
  const undo = panel.undoCommit;
  await act(async () => root.render(<Probe value={value} open={false} />));
  await act(async () => undo());
  expect(value.undoCommit).not.toHaveBeenCalled();
});
it.each([false, true])(
  "does not publish a retired undo completion (reject=%s)",
  async (reject) => {
    let resolve!: (value: boolean) => void;
    let fail!: (error: Error) => void;
    const value = summary(false);
    value.undoCommit = vi.fn(
      () =>
        new Promise<boolean>((done, error) => {
          resolve = done;
          fail = error;
        }),
    );
    await act(async () => root.render(<Probe value={value} />));
    let operation!: Promise<void>;
    await act(async () => {
      operation = panel.undoCommit();
    });
    await act(async () => root.render(<Probe value={value} open={false} />));
    expect(panel.actionBusy).toBeNull();
    await act(async () => {
      if (reject) fail(new Error("Old undo failed"));
      else resolve(true);
      await operation;
    });
    expect(panel.actionMessage).toBeNull();
    expect(panel.actionError).toBeNull();
  },
);
it("coalesces pending undo delivery and preserves a successor's busy flag", async () => {
  const completions: ((value: boolean) => void)[] = [];
  const value = summary(false);
  value.undoCommit = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        completions.push(done);
      }),
  );
  await act(async () => root.render(<Probe value={value} />));
  const undo = panel.undoCommit;
  let old!: Promise<void>;
  await act(async () => {
    old = undo();
    void undo();
  });
  expect(value.undoCommit).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Probe value={value} open={false} />));
  await act(async () => root.render(<Probe value={value} />));
  let next!: Promise<void>;
  await act(async () => {
    next = panel.undoCommit();
  });
  expect(value.undoCommit).toHaveBeenCalledTimes(2);
  await act(async () => {
    completions[0](true);
    await old;
  });
  expect(panel.actionBusy).toBe("undo");
  expect(panel.actionMessage).toBeNull();
  await act(async () => {
    completions[1](true);
    await next;
  });
  expect(panel.actionBusy).toBeNull();
  expect(panel.actionMessage).toBeTruthy();
});
it("keeps the current undo failure visible without a success message", async () => {
  const value = summary(false);
  value.undoCommit = vi.fn(async () => {
    throw new Error("Undo refused");
  });
  await act(async () => root.render(<Probe value={value} />));
  await act(async () => panel.undoCommit());
  expect(panel.actionError).toBe("Undo refused");
  expect(panel.actionMessage).toBeNull();
  expect(panel.actionBusy).toBeNull();
});
it("clears an already published undo message when its context retires", async () => {
  const value = summary(false);
  await act(async () => root.render(<Probe value={value} />));
  await act(async () => panel.undoCommit());
  expect(panel.actionMessage).toBeTruthy();
  await act(async () => root.render(<Probe value={value} open={false} />));
  expect(panel.actionMessage).toBeNull();
  expect(panel.actionError).toBeNull();
});
it("does not revive a cached undo through a batched filesystem round trip", async () => {
  const value = summary(false);
  useWorkspaceEnvStore.setState({ env: environments[0] });
  await act(async () => root.render(<Probe value={value} />));
  const undo = panel.undoCommit;
  await act(async () => {
    useWorkspaceEnvStore.setState({ env: environments[2] });
    useWorkspaceEnvStore.setState({ env: environments[0] });
    await undo();
  });
  expect(value.undoCommit).not.toHaveBeenCalled();
  expect(panel.actionMessage).toBeNull();
  await act(async () => panel.undoCommit());
  expect(value.undoCommit).toHaveBeenCalledTimes(1);
});
