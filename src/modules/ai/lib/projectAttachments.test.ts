// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readPathAttachment } from "@/modules/ai/lib/pathAttachments";
import {
  canRequestFileAttachment,
  FILE_ATTACHMENT_EVENT,
  requestFileAttachment,
} from "@/modules/ai/lib/fileAttachmentRequest";
import { captureProjectAttachment } from "@/modules/ai/lib/projectAttachmentSource";
import { AiComposerProvider, useComposer } from "@/modules/ai/lib/composer";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";

const io = vi.hoisted(() => ({
  acquire: vi.fn(),
  canonical: vi.fn(),
  stat: vi.fn(),
  read: vi.fn(),
  native: vi.fn(),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/remote/filesystem", () => ({
  remoteCanonicalize: io.canonical,
  remoteStat: io.stat,
  remoteReadDocument: io.read,
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: { readFile: io.native } }));
vi.mock("@/modules/ai/hooks/useWhisperRecording", () => ({
  useWhisperRecording: () => ({}),
}));
vi.mock("@/modules/ai/lib/slashCommands", () => ({
  tryRunSlashCommand: () => ({ kind: "unhandled" }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
const path = "remote://voktty-ssh-fixture/srv/project/file.txt";
const profile = {
  id: "fixture",
  name: "Fixture",
  host: "a.test",
  identityFile: "/keys/fixture",
};
const released: ReturnType<typeof vi.fn>[] = [];
function lease(): RemoteSessionLease {
  const release = vi.fn();
  released.push(release);
  return {
    info: {
      session_id: released.length,
      workspace_root: "/srv/project",
      architecture: "x86_64",
      helper_version: "1",
      capabilities: [],
    },
    release,
    releaseAndClose: vi.fn(async () => {}),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  released.length = 0;
  usePreferencesStore.setState({ sshConnections: [{ ...profile }] });
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/srv/project",
  });
  io.acquire.mockImplementation(async () => lease());
  io.canonical.mockResolvedValue("/srv/project/file.txt");
  io.stat.mockResolvedValue({ kind: "file", size: 8, mtime: 1 });
  io.read.mockResolvedValue({
    kind: "text",
    content: "original",
    size: 8,
    mtime: 1,
  });
});

it("reads a registered namespace through its own project lease without local fallback", async () => {
  expect(canRequestFileAttachment(path, { kind: "local" })).toBe(true);
  expect(
    await readPathAttachment(path, { kind: "local" }, () => true),
  ).toMatchObject({ name: "file.txt", text: "original", size: 8 });
  expect(io.acquire).toHaveBeenCalledExactlyOnceWith(
    { profileId: "fixture", root: "/srv/project" },
    expect.objectContaining({ host: "a.test" }),
  );
  expect(io.canonical).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 1 }),
    "/srv/project/file.txt",
  );
  expect(released[0]).toHaveBeenCalledOnce();
  expect(io.native).not.toHaveBeenCalled();
});

it("captures the original project and profile before its first await", async () => {
  const pending = readPathAttachment(path, { kind: "local" }, () => true);
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "b.test" }],
  });
  localStorage.clear();
  expect(await pending).toMatchObject({ text: "original" });
  expect(io.acquire).toHaveBeenCalledWith(
    expect.objectContaining({ root: "/srv/project" }),
    expect.objectContaining({ host: "a.test" }),
  );
});

it("refuses unknown projects and missing profiles before acquiring any transport", async () => {
  localStorage.clear();
  expect(canRequestFileAttachment(path, { kind: "local" })).toBe(false);
  expect(
    await readPathAttachment(path, { kind: "local" }, () => true),
  ).toBeNull();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({ sshConnections: [] });
  expect(
    await readPathAttachment(path, { kind: "local" }, () => true),
  ).toBeNull();
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.native).not.toHaveBeenCalled();
});

it("rejects literal secret paths before acquiring a project lease", async () => {
  expect(
    await readPathAttachment(
      path.replace("file.txt", ".env"),
      { kind: "local" },
      () => true,
    ),
  ).toBeNull();
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.native).not.toHaveBeenCalled();
});

it.each(["/srv/project/.ssh/id_rsa", "/outside/file.txt"])(
  "rejects canonical target %s before reading",
  async (canonical) => {
    io.canonical.mockResolvedValue(canonical);
    expect(
      await readPathAttachment(path, { kind: "local" }, () => true),
    ).toBeNull();
    expect(io.read).not.toHaveBeenCalled();
    expect(io.native).not.toHaveBeenCalled();
  },
);

it("rejects oversized metadata before reading and releases its project lease", async () => {
  io.stat.mockResolvedValue({ kind: "file", size: 200_001, mtime: 1 });
  expect(
    await readPathAttachment(path, { kind: "local" }, () => true),
  ).toBeNull();
  expect(io.read).not.toHaveBeenCalled();
  expect(released[0]).toHaveBeenCalledOnce();
});

it("bounds decoded text without truncating a valid larger attachment to inline-reference size", async () => {
  io.read.mockResolvedValue({
    kind: "text",
    content: "x".repeat(10_000),
    size: 10_000,
  });
  expect(
    (await readPathAttachment(path, { kind: "local" }, () => true))?.text,
  ).toHaveLength(10_000);
  io.read.mockResolvedValue({
    kind: "text",
    content: "x".repeat(200_001),
    size: 8,
  });
  expect(
    await readPathAttachment(path, { kind: "local" }, () => true),
  ).toBeNull();
});

it("retains sixteen cancelled acquisitions until each original lease settles", async () => {
  let current = true;
  const settle: Array<(lease: RemoteSessionLease) => void> = [];
  io.acquire.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle.push(resolve);
      }),
  );
  const pending = Array.from({ length: 16 }, () =>
    readPathAttachment(path, { kind: "local" }, () => current),
  );
  await vi.dynamicImportSettled();
  expect(settle).toHaveLength(16);
  current = false;
  expect(
    await readPathAttachment(path, { kind: "local" }, () => true),
  ).toBeNull();
  expect(
    await readPathAttachment("/native/file.ts", { kind: "local" }, () => true),
  ).toBeNull();
  expect(io.native).not.toHaveBeenCalled();
  settle.forEach((resolve) => {
    resolve(lease());
  });
  expect(await Promise.all(pending)).toEqual(Array(16).fill(null));
  for (const release of released) expect(release).toHaveBeenCalledOnce();
  expect(io.canonical).not.toHaveBeenCalled();
  expect(io.read).not.toHaveBeenCalled();
  io.acquire.mockImplementation(async () => lease());
  expect(
    await readPathAttachment(path, { kind: "local" }, () => true),
  ).toMatchObject({ text: "original" });
});

it("distinguishes a replacement SSH binding while keeping an admitted snapshot immutable", async () => {
  const source = captureProjectAttachment(path);
  if (!source) throw new Error("Missing source fixture");
  expect(Object.isFrozen(source)).toBe(true);
  expect(Object.isFrozen(source.profile)).toBe(true);
  const original = await readPathAttachment(
    path,
    { kind: "local" },
    () => true,
    source,
  );
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "b.test" }],
  });
  const replacement = await readPathAttachment(
    path,
    { kind: "local" },
    () => true,
  );
  expect(original?.id).not.toBe(replacement?.id);
  io.acquire.mockClear();
  expect(
    await readPathAttachment(path, { kind: "local" }, () => true, {
      ...source,
    }),
  ).toBeNull();
  expect(
    await readPathAttachment(
      path.replace("file.txt", "other.txt"),
      { kind: "local" },
      () => true,
      source,
    ),
  ).toBeNull();
  expect(io.acquire).not.toHaveBeenCalled();
});

it("never falls back locally after a remote read fails", async () => {
  io.read.mockRejectedValue(new Error("synthetic failure"));
  expect(
    await readPathAttachment(path, { kind: "local" }, () => true),
  ).toBeNull();
  expect(released[0]).toHaveBeenCalledOnce();
  expect(io.native).not.toHaveBeenCalled();
});

it("keeps its lease until a retired read actually settles", async () => {
  let current = true;
  let finish!: (result: {
    kind: "text";
    content: string;
    size: number;
  }) => void;
  io.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = readPathAttachment(path, { kind: "local" }, () => current);
  await vi.dynamicImportSettled();
  expect(io.read).toHaveBeenCalledOnce();
  current = false;
  expect(released[0]).not.toHaveBeenCalled();
  finish({ kind: "text", content: "retired", size: 7 });
  expect(await pending).toBeNull();
  expect(released[0]).toHaveBeenCalledOnce();
});

it("carries the original project snapshot through the real compositor's synchronous event", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useChatStore.setState({
    activeSessionId: "original",
    sessions: [
      { id: "original", title: "Original", createdAt: 1, updatedAt: 1 },
    ],
    pendingSelections: [],
    focusSignal: 0,
    pendingPrefill: null,
  });
  const state: { composer?: ReturnType<typeof useComposer> } = {};
  function Probe() {
    state.composer = useComposer();
    return null;
  }
  const mutate = () => {
    usePreferencesStore.setState({
      sshConnections: [{ ...profile, host: "b.test" }],
    });
    localStorage.clear();
  };
  window.addEventListener(FILE_ATTACHMENT_EVENT, mutate);
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(
        createElement(AiComposerProvider, null, createElement(Probe)),
      ),
    );
    await act(async () => {
      expect(requestFileAttachment(path, { kind: "local" })).toBe(true);
      await vi.dynamicImportSettled();
    });
    expect(state.composer?.files).toEqual([
      expect.objectContaining({ text: "original", name: "file.txt" }),
    ]);
    expect(io.acquire).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ host: "a.test" }),
    );
    expect(io.native).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener(FILE_ATTACHMENT_EVENT, mutate);
    useChatStore.setState({ activeSessionId: null, sessions: [] });
    vi.unstubAllGlobals();
  }
});
