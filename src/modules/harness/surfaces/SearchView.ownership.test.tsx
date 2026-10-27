// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchView } from "@/modules/harness/surfaces/SearchView";
import { invalidateProjectFiles } from "@/modules/harness/lib/fileIndex";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const io = vi.hoisted(() => ({
  index: vi.fn(),
  search: vi.fn(),
  request: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  session: vi.fn(),
  project: vi.fn(),
  sessionSearch: vi.fn(),
  nativeIndex: vi.fn(),
}));
vi.mock("@/modules/connections/model/remoteCommands", () => ({
  readCapturedProjectIndex: io.index,
}));
vi.mock("@/modules/harness/lib/search", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/search")>()),
  searchProject: io.search,
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/remote/client", () => ({ requestRemoteResult: io.request }));
vi.mock("@/modules/harness/lib/sessionStore", () => ({
  searchSessions: io.sessionSearch,
}));
vi.mock("@/modules/harness/lib/fs", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/fs")>()),
  listProjectFiles: io.nativeIndex,
}));
vi.mock("@/modules/harness/chrome/TitleBar", () => ({
  OverlayNav: () => null,
}));
vi.mock("@/modules/harness/chrome/FileTypeIcon", () => ({
  FileTypeIcon: () => null,
}));
vi.mock("@/modules/harness/chrome/ProjectLogoIcon", () => ({
  ProjectLogoIcon: () => null,
}));

const cwd = "remote://voktty-ssh-fixture/alias/project";
const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
let root: Root;
let container: HTMLDivElement;
let scroll: PropertyDescriptor | undefined;
const recents = [{ path: "/fixtures/needle-project", openedAt: 1 }];

async function render(open = true, folder = cwd, strict = false) {
  await act(async () =>
    root.render(
      createElement(
        strict ? StrictMode : "div",
        null,
        createElement(SearchView, {
          open,
          cwd: folder,
          recents,
          history: [],
          sessions: [],
          onOpenFile: io.open,
          onClose: io.close,
          onOpenSession: io.session,
          onOpenProject: io.project,
        }),
      ),
    ),
  );
}

function optionContaining(text: string) {
  const option = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((entry) => entry.textContent?.includes(text));
  if (!option) throw new Error(`Missing result: ${text}`);
  return option;
}

function row(kind: "file" | "content") {
  const option = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((entry) =>
    entry.textContent?.includes(kind === "file" ? "needle.ts" : "content.ts:3"),
  );
  if (!option)
    throw new Error(`Missing ${kind} result: ${container.textContent}`);
  return option;
}

async function query(text: string) {
  const input = container.querySelector("input");
  if (!input) throw new Error("Missing search input.");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.resetAllMocks();
  io.sessionSearch.mockResolvedValue({ hits: [] });
  io.nativeIndex.mockResolvedValue([]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/alias/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  io.index.mockResolvedValue([
    { name: "needle.ts", relative: "needle.ts", path: `${cwd}/needle.ts` },
  ]);
  io.search.mockResolvedValue({
    matches: [
      {
        path: `${cwd}/content.ts`,
        relative: "content.ts",
        line: 3,
        column: 4,
        preview: "needle",
      },
    ],
    truncated: false,
  });
  io.request.mockResolvedValue({
    hits: [{ rel: "content.ts", line: 3, column: 4, text: "needle" }],
    truncated: false,
  });
  io.acquire.mockResolvedValue({
    info: { session_id: 7, workspace_root: "/actual/project" },
    release: io.release,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await import("@/modules/remote/projectDocument");
  vi.useFakeTimers();
  await query("needle");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  row("file");
  row("content");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  invalidateProjectFiles();
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
  if (scroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", scroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["file", "content"] as const)(
  "rejects a captured %s row before React commits a profile round trip",
  async (kind) => {
    const captured = row(kind);
    await act(async () => {
      usePreferencesStore.setState({
        sshConnections: [{ ...profile, host: "replacement.invalid" }],
      });
      usePreferencesStore.setState({ sshConnections: [profile] });
      captured.click();
    });
    expect(io.open).not.toHaveBeenCalled();
    expect(io.close).not.toHaveBeenCalled();
  },
);

it("does not close the replacement source after a reentrant file open", async () => {
  io.open.mockImplementation(() =>
    usePreferencesStore.setState({ sshConnections: [] }),
  );
  await act(async () => row("content").click());
  expect(io.open).toHaveBeenCalledExactlyOnceWith(
    `${cwd}/content.ts`,
    { line: 3, column: 4 },
    { exact: true },
  );
  expect(io.close).not.toHaveBeenCalled();
});

it.each(["profile", "missing", "project"])(
  "withdraws file and content delivery across %s replacement",
  async (change) => {
    const file = row("file");
    const content = row("content");
    await act(async () => {
      if (change === "project")
        rememberRemoteProject("voktty-ssh-fixture", {
          id: "replacement",
          name: "Project",
          cwd: "/alias/project",
        });
      else
        usePreferencesStore.setState({
          sshConnections:
            change === "missing"
              ? []
              : [{ ...profile, host: "replacement.invalid" }],
        });
      file.click();
      content.click();
    });
    expect(io.open).not.toHaveBeenCalled();
    expect(io.close).not.toHaveBeenCalled();
  },
);

it("delivers the current remote search through its captured reader", async () => {
  await act(async () => row("content").click());
  expect(io.open).toHaveBeenCalledExactlyOnceWith(
    `${cwd}/content.ts`,
    { line: 3, column: 4 },
    { exact: true },
  );
  expect(io.search).not.toHaveBeenCalled();
  expect(io.close).toHaveBeenCalledOnce();
});

it.each(["resolve", "reject"])(
  "discards a retired search %s after the replacement result arrives",
  async (outcome) => {
    let finish!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    io.request.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    io.release.mockClear();
    await query("needle-old");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(io.release).not.toHaveBeenCalled();
    io.request.mockResolvedValue({
      hits: [{ rel: "replacement.ts", line: 3, column: 4, text: "needle-old" }],
      truncated: false,
    });
    await act(async () => {
      usePreferencesStore.setState({
        sshConnections: [{ ...profile, host: "replacement.invalid" }],
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(optionContaining("replacement.ts:3")).toBeTruthy();
    expect(io.release).toHaveBeenCalledOnce();
    await act(async () => {
      if (outcome === "resolve")
        finish({
          hits: [{ rel: "retired.ts", line: 3, column: 1, text: "needle-old" }],
          truncated: false,
        });
      else fail(new Error("Retired search error"));
    });
    expect(container.textContent).not.toContain("retired.ts");
    expect(container.textContent).not.toContain("Retired search error");
    expect(io.release).toHaveBeenCalledTimes(2);
    await act(async () => optionContaining("replacement.ts:3").click());
    expect(io.open).toHaveBeenCalledExactlyOnceWith(
      `${cwd}/replacement.ts`,
      { line: 3, column: 4 },
      { exact: true },
    );
  },
);

it("keeps global project and conversation results usable without the SSH source", async () => {
  io.sessionSearch.mockResolvedValue({
    hits: [
      {
        kind: "conversation",
        sessionId: "conversation",
        title: "needle conversation",
        cwd: "/fixtures/project",
        harness: "codex",
        updatedAt: 1,
      },
    ],
  });
  await act(async () => usePreferencesStore.setState({ sshConnections: [] }));
  await query("need");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  await act(async () => optionContaining("needle conversation").click());
  expect(io.session).toHaveBeenCalledExactlyOnceWith("conversation");
  await act(async () => optionContaining("needle-project").click());
  expect(io.project).toHaveBeenCalledExactlyOnceWith(
    "/fixtures/needle-project",
  );
  expect(io.open).not.toHaveBeenCalled();
});

it.each(["/fixtures/local", "remote://legacy-host/fixtures/project"])(
  "preserves the existing content search route for %s",
  async (folder) => {
    io.search.mockClear();
    await render(true, folder);
    await query("needle-local");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(io.search).toHaveBeenCalledExactlyOnceWith({
      cwd: folder,
      query: "needle-local",
    });
  },
);

it("removes pending delivery on hide and reopens a fresh search in StrictMode", async () => {
  let finish!: (value: unknown) => void;
  io.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await query("needle-old");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  await render(false);
  await act(async () =>
    finish({
      hits: [{ rel: "retired.ts", line: 3, column: 1, text: "needle" }],
      truncated: false,
    }),
  );
  expect(container.querySelector('[role="option"]')).toBeNull();
  await render(true, cwd, true);
  await query("needle");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(container.textContent).not.toContain("retired.ts");
  await act(async () => row("content").click());
  expect(io.open).toHaveBeenCalledExactlyOnceWith(
    `${cwd}/content.ts`,
    { line: 3, column: 4 },
    { exact: true },
  );
});
