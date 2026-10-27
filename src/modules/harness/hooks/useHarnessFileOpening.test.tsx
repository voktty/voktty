// @vitest-environment happy-dom
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHarnessFileOpening } from "@/modules/harness/hooks/useHarnessFileOpening";
import {
  newEditorPane,
  newFileTab,
  newTab,
  type WorkspaceTab,
} from "@/modules/harness/lib/layout";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const io = vi.hoisted(() => ({
  resolve: vi.fn(),
  remember: vi.fn(),
  navigate: vi.fn(),
  changes: vi.fn(),
  focus: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileIndex", () => ({
  resolveFileOpenRequest: io.resolve,
  rememberOpenedFile: io.remember,
}));
let root: Root;
let node: HTMLDivElement;
let opening: ReturnType<typeof useHarnessFileOpening>;
let tabs: WorkspaceTab[];
let original: WorkspaceTab;
let permitCurrent: boolean;
const remote = "remote://voktty-ssh-fixture/srv/project";
const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
function Host({
  cwd = "/project",
  projectCwd = cwd,
  enabled = true,
  deckLayout = true,
  metadata = false,
}: {
  cwd?: string;
  projectCwd?: string;
  enabled?: boolean;
  deckLayout?: boolean;
  metadata?: boolean;
}) {
  const [state, setTabs] = useState([original]);
  tabs = state;
  opening = useHarnessFileOpening({
    tabs: metadata ? state.map((tab) => ({ ...tab, groupId: "group" })) : state,
    activeTabId: original.id,
    cwd,
    projectCwd,
    enabled,
    deckLayout,
    capture: () => ({ isCurrent: () => permitCurrent }),
    setTabs,
    navigate: io.navigate,
    showChanges: io.changes,
    focusEditor: io.focus,
    onError: io.error,
  });
  return null;
}
function deferred() {
  let resolve!: (path: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function render(props: Parameters<typeof Host>[0] = {}) {
  await act(async () =>
    root.render(
      <StrictMode>
        <Host {...props} />
      </StrictMode>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  const pane = newEditorPane(newFileTab("/project/original.ts", "/project"));
  original = { ...newTab(pane.id), filePanes: [pane] };
  permitCurrent = true;
  for (const mock of Object.values(io)) mock.mockReset();
  io.resolve.mockImplementation(async (_cwd: string, path: string) => path);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each(["file", "diff"] as const)(
  "opens a current %s under its captured root",
  async (mode) => {
    await render({ cwd: "/worktree", projectCwd: "/project" });
    await act(async () => {
      if (mode === "file") opening.onOpenFile("/worktree/new.ts", { line: 3 });
      else
        opening.onOpenDiff("/worktree/new.ts", undefined, {
          exact: true,
          repoRoot: "/repo",
        });
    });
    expect(tabs[0].filePanes[0].files[1]).toMatchObject({
      path: "/worktree/new.ts",
      cwd: mode === "file" ? "/project" : "/repo",
      ...(mode === "diff" ? { review: true } : {}),
    });
    expect(io.remember).toHaveBeenCalledExactlyOnceWith(
      "/project",
      "/worktree/new.ts",
    );
    expect(io.focus).toHaveBeenCalledOnce();
    expect(mode === "file" ? io.navigate : io.changes).toHaveBeenCalledOnce();
  },
);

it.each([
  "cwd",
  "project",
  "hidden",
  "permit",
  "roundtrip",
  "unmount",
] as const)("retires file delivery and feedback after %s", async (reason) => {
  const read = deferred();
  io.resolve.mockReturnValueOnce(read.promise);
  await render();
  const old = opening.onOpenFile;
  await act(async () => old("pending.ts", { line: 2 }));
  if (reason === "cwd") await render({ cwd: "/replacement" });
  if (reason === "project") await render({ projectCwd: "/replacement" });
  if (reason === "hidden") await render({ enabled: false });
  if (reason === "permit") permitCurrent = false;
  if (reason === "roundtrip") {
    await render({ cwd: "/replacement" });
    await render();
  }
  if (reason === "unmount") await act(async () => root.render(null));
  await act(async () => read.resolve("/project/pending.ts"));
  expect(tabs).toEqual([original]);
  expect(io.remember).not.toHaveBeenCalled();
  expect(io.navigate).not.toHaveBeenCalled();
  expect(io.focus).not.toHaveBeenCalled();
  expect(io.error).not.toHaveBeenCalled();
  if (reason !== "permit") {
    await act(async () => old("cached.ts"));
    expect(io.resolve).toHaveBeenCalledOnce();
  }
});

it("preserves pending delivery through an ordinary callback and metadata rerender", async () => {
  const read = deferred();
  io.resolve.mockReturnValueOnce(read.promise);
  await render();
  await act(async () => opening.onOpenFile("pending.ts"));
  await render({ metadata: true });
  await act(async () => read.resolve("/project/pending.ts"));
  expect(tabs[0].filePanes[0].files[1].path).toBe("/project/pending.ts");
});

it("keeps only the newest requested file selection when reads finish out of order", async () => {
  const first = deferred(),
    second = deferred();
  io.resolve
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await render();
  await act(async () => {
    opening.onOpenFile("first.ts");
    opening.onOpenFile("second.ts");
  });
  await act(async () => second.resolve("/project/second.ts"));
  await act(async () => first.resolve("/project/first.ts"));
  expect(tabs[0].filePanes[0].files.map((file) => file.path)).toEqual([
    "/project/original.ts",
    "/project/second.ts",
  ]);
  expect(io.remember).toHaveBeenCalledOnce();
});

it.each(["file", "diff"] as const)(
  "retires a pending %s after an SSH profile roundtrip",
  async (mode) => {
    const read = deferred();
    io.resolve.mockReturnValueOnce(read.promise);
    await render({ cwd: remote });
    await act(async () => {
      if (mode === "file")
        opening.onOpenFile(`${remote}/file.ts`, undefined, { exact: true });
      else opening.onOpenDiff(`${remote}/file.ts`, undefined, { exact: true });
    });
    await act(async () => {
      usePreferencesStore.setState({ sshConnections: [] });
      usePreferencesStore.setState({ sshConnections: [profile] });
      read.resolve(`${remote}/file.ts`);
    });
    expect(tabs).toEqual([original]);
    expect(io.remember).not.toHaveBeenCalled();
    expect(io.changes).not.toHaveBeenCalled();
    expect(io.error).not.toHaveBeenCalled();
  },
);

it("publishes a healthy SSH file before releasing its original source observer", async () => {
  await render({ cwd: remote });
  await act(async () => opening.onOpenFile(`${remote}/file.ts`));
  expect(tabs[0].filePanes[0].files[1]).toMatchObject({
    path: `${remote}/file.ts`,
    cwd: remote,
  });
});

it("refuses a missing saved SSH project without a local fallback", async () => {
  usePreferencesStore.setState({ sshConnections: [] });
  await render({ cwd: remote });
  await act(async () => opening.onOpenFile(`${remote}/file.ts`));
  expect(io.resolve).not.toHaveBeenCalled();
  expect(io.error).toHaveBeenCalledOnce();
});

it("handles a current read rejection but suppresses a retired read error", async () => {
  io.resolve.mockRejectedValueOnce(new Error("Read failed"));
  await render();
  await act(async () => opening.onOpenFile("failed.ts"));
  expect(io.error).toHaveBeenCalledOnce();
  io.error.mockClear();
  const read = deferred();
  io.resolve.mockReturnValueOnce(read.promise);
  await act(async () => opening.onOpenFile("retired.ts"));
  await render({ enabled: false });
  await act(async () => read.reject(new Error("Old read failed")));
  expect(io.error).not.toHaveBeenCalled();
});

it("retains all 256 unsettled resolutions after retirement and recovers only on actual settlement", async () => {
  const reads = Array.from({ length: 257 }, deferred);
  for (const read of reads) io.resolve.mockReturnValueOnce(read.promise);
  await render();
  await act(async () => {
    for (let i = 0; i < 256; i++) opening.onOpenFile(`file-${i}.ts`);
  });
  await render({ cwd: "/replacement" });
  await act(async () => opening.onOpenFile("overflow.ts"));
  expect(io.resolve).toHaveBeenCalledTimes(256);
  expect(io.error).toHaveBeenCalledOnce();
  await act(async () => reads[0].resolve("/project/old.ts"));
  await act(async () => opening.onOpenFile("current.ts"));
  expect(io.resolve).toHaveBeenCalledTimes(257);
  await act(async () => {
    for (let i = 1; i < 256; i++) reads[i].resolve(`/project/old-${i}.ts`);
    reads[256].resolve("/replacement/current.ts");
  });
  expect(tabs[0].filePanes[0].files[1].path).toBe("/replacement/current.ts");
});

it("keeps captured session-review and classic diff behavior", async () => {
  await render({ deckLayout: false });
  await act(async () => opening.onOpenDiff());
  expect(tabs[0]).toMatchObject({ diffOpen: true, diffFocused: true });
  await act(async () =>
    opening.onOpenDiff("/session/file.ts", {
      sessionId: "source",
      cwd: "/session",
      view: "commit",
    }),
  );
  expect(tabs[0].filePanes[0].files[1]).toMatchObject({
    cwd: "/session",
    sessionChanges: { sessionId: "source", view: "commit" },
  });
});

it("preserves the admitted selection when a full-budget request is refused", async () => {
  const reads = Array.from({ length: 256 }, deferred);
  for (const read of reads) io.resolve.mockReturnValueOnce(read.promise);
  await render();
  await act(async () => {
    for (let i = 0; i < 256; i++) opening.onOpenFile(`file-${i}.ts`);
    opening.onOpenFile("overflow.ts");
  });
  expect(io.resolve).toHaveBeenCalledTimes(256);
  await act(async () => {
    reads[255].resolve("/project/admitted.ts");
    for (let i = 0; i < 255; i++) reads[i].resolve(`/project/old-${i}.ts`);
  });
  expect(tabs[0].filePanes[0].files[1].path).toBe("/project/admitted.ts");
});
