// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGitCollectionMenu } from "@/modules/source-control/useGitCollectionMenu";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: feedback }));
type Entry = { index: number; value: string };
const initial: Entry[] = [{ index: 0, value: "old" }];
const keyOf = (entry: Entry) => String(entry.index);
const load =
  vi.fn<(root: string, workspace: WorkspaceEnv) => Promise<Entry[]>>();
const mutate =
  vi.fn<(root: string, workspace: WorkspaceEnv) => Promise<void>>();
const refresh = vi.fn();
const local: WorkspaceEnv = { kind: "local" };
let root: Root;
let view: ReturnType<typeof useGitCollectionMenu<Entry>>;
function Probe({
  path = "/repo",
  context = "",
}: {
  path?: string | null;
  context?: string;
}) {
  view = useGitCollectionMenu({
    repoRoot: path,
    contextKey: context,
    load,
    keyOf,
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
const open = () => act(async () => view.setMenuOpen(true));
const close = () => act(async () => view.setMenuOpen(false));
async function dialog() {
  await open();
  await act(async () => view.openDialog());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useWorkspaceEnvStore.setState({ env: local });
  load.mockReset().mockResolvedValue(initial);
  mutate.mockReset().mockResolvedValue(undefined);
  refresh.mockReset();
  feedback.success.mockReset();
  feedback.error.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  useWorkspaceEnvStore.setState({ env: local });
  vi.unstubAllGlobals();
});
it("does no work while closed or without a repository", async () => {
  await act(async () => root.render(<Probe path={null} />));
  await open();
  await act(async () => {
    view.openDialog();
    await view.runEntry("0", mutate, "Done");
    await view.submitDialog(mutate, "Done");
  });
  expect(load).not.toHaveBeenCalled();
  expect(mutate).not.toHaveBeenCalled();
  await act(async () => root.render(<Probe />));
  expect(load).not.toHaveBeenCalled();
});
it.each<WorkspaceEnv>([
  local,
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "ssh",
    root: "/repo",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  },
  {
    kind: "docker",
    connection: { containerId: "box", containerName: "Box", image: "image" },
  },
])(
  "preserves the captured $kind filesystem on lists and mutations",
  async (workspace) => {
    useWorkspaceEnvStore.setState({ env: workspace });
    await act(async () => root.render(<Probe />));
    await open();
    expect(load).toHaveBeenCalledExactlyOnceWith("/repo", workspace);
    expect(load.mock.calls[0][1]).not.toBe(workspace);
    await act(async () => view.runEntry("0", mutate, "Done"));
    expect(mutate).toHaveBeenCalledExactlyOnceWith("/repo", workspace);
    expect(refresh).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(2);
  },
);
it.each(["C:/repo", "//server/share/repo", "remote://voktty-ssh-build/repo"])(
  "preserves the existing native router target %s",
  async (path) => {
    await act(async () => root.render(<Probe path={path} />));
    await dialog();
    await act(async () => view.submitDialog(mutate, "Created"));
    expect(mutate).toHaveBeenCalledExactlyOnceWith(path, local);
  },
);
it("suppresses a closed reader's late error and cached menu callbacks", async () => {
  const pending = deferred<Entry[]>();
  load.mockReturnValueOnce(pending.promise);
  await act(async () => root.render(<Probe />));
  await open();
  const old = view;
  await close();
  await open();
  await act(async () => {
    pending.reject(new Error("Retired list"));
    old.openDialog();
    await old.runEntry("0", mutate, "Old");
  });
  expect(view.items).toEqual(initial);
  expect(view.error).toBeNull();
  expect(view.dialogKey).toBeNull();
  expect(mutate).not.toHaveBeenCalled();
});
it("rejects a stale numeric-index callback after a list publication changes", async () => {
  await act(async () => root.render(<Probe />));
  await open();
  const old = view.runEntry;
  load.mockResolvedValueOnce([{ index: 0, value: "replacement stash" }]);
  await act(async () => view.runEntry("0", mutate, "Popped"));
  expect(view.items[0].value).toBe("replacement stash");
  await act(async () => old("0", mutate, "Wrong stash"));
  expect(mutate).toHaveBeenCalledOnce();
});
it("prevents synchronous duplicate operations and retains native capacity after cancellation", async () => {
  const pending = deferred<void>();
  mutate.mockReturnValue(pending.promise);
  await act(async () => root.render(<Probe />));
  await dialog();
  const old = view;
  let work!: Promise<void>;
  await act(async () => {
    work = old.submitDialog(mutate, "Created");
    await old.submitDialog(mutate, "Duplicate");
  });
  await act(async () => view.setDialogOpen(false));
  await dialog();
  const replacementKey = view.dialogKey;
  expect(view.busyKey).toBeNull();
  expect(view.actionPending).toBe(true);
  await act(async () => {
    old.setDialogOpen(false);
    await view.submitDialog(mutate, "Too soon");
  });
  expect(view.dialogKey).toBe(replacementKey);
  expect(mutate).toHaveBeenCalledOnce();
  await act(async () => {
    pending.resolve();
    await work;
  });
  expect(view.dialogKey).toBe(replacementKey);
  expect(view.actionPending).toBe(false);
  expect(feedback.success).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it("refreshes current menu facts after a dismissed mutation without reviving its old row", async () => {
  const pending = deferred<void>();
  mutate.mockReturnValueOnce(pending.promise);
  await act(async () => root.render(<Probe />));
  await open();
  let work!: Promise<void>;
  await act(async () => {
    work = view.runEntry("0", mutate, "Applied");
  });
  await close();
  await open();
  const old = view.runEntry;
  load.mockResolvedValueOnce([{ index: 0, value: "current" }]);
  await act(async () => {
    pending.resolve();
    await work;
  });
  expect(view.items[0].value).toBe("current");
  expect(refresh).toHaveBeenCalledOnce();
  expect(feedback.success).not.toHaveBeenCalled();
  await act(async () => old("0", mutate, "Old index"));
  expect(mutate).toHaveBeenCalledOnce();
});
it.each(["root", "target", "unmount"])(
  "retires an accepted operation on %s replacement",
  async (change) => {
    const pending = deferred<void>();
    mutate.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<Probe />));
    await open();
    let work!: Promise<void>;
    await act(async () => {
      work = view.runEntry("0", mutate, "Done");
    });
    await act(async () =>
      root.render(
        change === "unmount" ? null : (
          <Probe
            path={change === "root" ? "/new" : "/repo"}
            context={change === "target" ? "new" : ""}
          />
        ),
      ),
    );
    await act(async () => {
      pending.resolve();
      await work;
    });
    expect(feedback.success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    if (change === "unmount")
      await act(async () => root.render(<Probe path="/replacement" />));
    expect(view.busyKey).toBeNull();
  },
);
it("never revives dialog writes after a filesystem round trip before commit", async () => {
  const pending = deferred<void>();
  mutate.mockReturnValueOnce(pending.promise);
  await act(async () => root.render(<Probe />));
  await dialog();
  const old = view;
  let work!: Promise<void>;
  await act(async () => {
    work = view.submitDialog(mutate, "Done");
  });
  await act(async () => {
    useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Ubuntu" } });
    useWorkspaceEnvStore.setState({ env: local });
    pending.resolve();
    await work;
    await old.submitDialog(mutate, "Revived");
  });
  expect(mutate).toHaveBeenCalledOnce();
  expect(feedback.success).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(view.dialogKey).toBeNull();
});
it("keeps inline errors only in their own current dialog", async () => {
  await act(async () => root.render(<Probe />));
  await dialog();
  mutate.mockRejectedValueOnce(new Error("Current refusal"));
  await act(async () => view.submitDialog(mutate, "Done", true));
  expect(view.dialogError).toBe("Current refusal");
  expect(feedback.error).not.toHaveBeenCalled();
  await act(async () => view.setDialogOpen(false));
  await dialog();
  expect(view.dialogError).toBeNull();
  const pending = deferred<void>();
  mutate.mockReturnValueOnce(pending.promise);
  let work!: Promise<void>;
  await act(async () => {
    work = view.submitDialog(mutate, "Old", true);
  });
  await act(async () => view.setDialogOpen(false));
  await dialog();
  await act(async () => {
    pending.reject(new Error("Old failure"));
    await work;
  });
  expect(view.dialogError).toBeNull();
  expect(view.dialogKey).not.toBeNull();
});
it("does not refresh or reload the list after a tag-style push", async () => {
  await act(async () => root.render(<Probe />));
  await open();
  await act(async () => view.runEntry("0", mutate, "Pushed", false));
  expect(load).toHaveBeenCalledOnce();
  expect(refresh).not.toHaveBeenCalled();
  expect(feedback.success).toHaveBeenCalledExactlyOnceWith("Pushed");
});
it("counts retired native mutations until settlement and explains exhausted dialog capacity", async () => {
  const pending: ReturnType<typeof deferred<void>>[] = [];
  mutate.mockImplementation(() => {
    const item = deferred<void>();
    pending.push(item);
    return item.promise;
  });
  for (let index = 0; index < 256; index++) {
    await act(async () => root.render(<Probe path={`/repo-${index}`} />));
    await dialog();
    await act(async () => {
      void view.submitDialog(mutate, "Done");
    });
  }
  await act(async () => root.render(<Probe path="/current" />));
  await open();
  expect(view.error).toBe("Wait for the current Git action to finish.");
  await act(async () => view.openDialog());
  await act(async () => view.submitDialog(mutate, "Denied", true));
  expect(view.dialogError).toBe("Wait for the current Git action to finish.");
  expect(mutate).toHaveBeenCalledTimes(256);
  await act(async () => pending[0].resolve());
  let current!: Promise<void>;
  await act(async () => {
    current = view.submitDialog(mutate, "Current", true);
  });
  expect(mutate).toHaveBeenCalledTimes(257);
  await act(async () => {
    for (const item of pending) item.resolve();
    await current;
  });
  expect(feedback.success).toHaveBeenCalledExactlyOnceWith("Current");
  expect(refresh).toHaveBeenCalledOnce();
});
