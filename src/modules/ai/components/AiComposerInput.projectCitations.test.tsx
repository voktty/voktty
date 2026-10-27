// @vitest-environment happy-dom
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiComposerInput } from "@/modules/ai/components/AiComposerInput";
import { useChatStore } from "@/modules/ai/store/chatStore";
import type { FileAttachment, useComposer } from "@/modules/ai/lib/composer";
import { readPathAttachment } from "@/modules/ai/lib/pathAttachments";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  rememberRemoteProject,
  forgetRemoteProject,
} from "@/modules/connections/model/remoteProjects";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";

const io = vi.hoisted(() => ({
  composer: null as ReturnType<typeof useComposer> | null,
  pick: null as ((path: string) => void) | null,
  files: [] as string[],
  acquire: vi.fn(),
  request: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@/modules/ai/lib/composer", () => ({
  useComposer: () => io.composer,
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverAnchor: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/modules/ai/components/FilePicker", () => ({
  FilePickerContent: ({
    files,
    onPick,
  }: {
    files: string[];
    onPick: (path: string) => void;
  }) => {
    io.files = files;
    io.pick = onPick;
    return null;
  },
}));
vi.mock("@/modules/ai/components/SnippetPicker", () => ({
  SnippetPickerContent: () => null,
}));
vi.mock("@/modules/preview", () => ({ LiveComponentBadge: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: io.request,
}));
vi.mock("@/modules/ssh-native/handles", () => ({
  nativeHandleFor: async () => undefined,
}));

const profile = { id: "citation", name: "Citation", host: "original.invalid" };
const namespace = "remote://voktty-ssh-citation/alias/project";
let root: Root | null;
let frames: FrameRequestCallback[];
let attachments: FileAttachment[];
let leases: RemoteSessionLease[];
let selectedRoot: string;
const register = () =>
  rememberRemoteProject("voktty-ssh-citation", {
    id: "project",
    name: "Project",
    cwd: "/alias/project",
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = [];
  attachments = [];
  leases = [];
  io.files = [];
  selectedRoot = namespace;
  localStorage.clear();
  register();
  usePreferencesStore.setState({ sshConnections: [profile] });
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) =>
    frames.push(frame),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  useChatStore.setState({
    activeSessionId: "original",
    sessions: ["original", "successor"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
    })),
    live: {
      ...useChatStore.getState().live,
      getFileCitationSource: () => ({
        kind: "local",
        root: selectedRoot,
        workspace: { kind: "local" },
      }),
    },
  });
  io.composer = {
    value: "@",
    textareaRef: { current: null },
    voice: {},
    setValue: vi.fn(),
    attachFileByPath: vi.fn<ReturnType<typeof useComposer>["attachFileByPath"]>(
      async (path, workspace, current, source) => {
        const attachment = await readPathAttachment(
          path,
          workspace,
          current ?? (() => true),
          source,
        );
        if (!attachment || !current?.()) return false;
        attachments.push(attachment);
        return true;
      },
    ),
  } as unknown as ReturnType<typeof useComposer>;
  io.acquire.mockImplementation(async () => {
    const lease: RemoteSessionLease = {
      info: {
        session_id: 17,
        workspace_root: "/actual/project",
        architecture: "x86_64",
        helper_version: "1",
        capabilities: ["fs.glob", "fs.canonicalize"],
      },
      release: vi.fn(),
    };
    leases.push(lease);
    return lease;
  });
  io.request.mockImplementation(async (_id, method) => {
    if (method === "fs.glob")
      return { hits: [{ rel: "deep/file.ts" }], truncated: false };
    if (method === "fs.canonicalize")
      return { path: "/actual/project/deep/file.ts" };
    if (method === "fs.stat") return { kind: "file", size: 7, mtime: 1 };
    if (method === "fs.readFile")
      return { content: "content", size: 7, mtime: 1 };
    throw new Error(`Unexpected method ${method}`);
  });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function open(strict = false) {
  await act(async () =>
    root?.render(
      strict
        ? createElement(StrictMode, null, createElement(AiComposerInput))
        : createElement(AiComposerInput),
    ),
  );
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(io.files).toEqual(["deep/file.ts"]);
}

it("does not observe projects or start IO until the citation picker opens", async () => {
  if (!io.composer) throw new Error("Missing composer");
  io.composer.value = "ordinary text";
  const subscribe = vi.spyOn(usePreferencesStore, "subscribe");
  await act(async () => root?.render(createElement(AiComposerInput)));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(subscribe).not.toHaveBeenCalled();
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
  subscribe.mockRestore();
});

it("rejects an unknown namespace without opening a native or remote filesystem", async () => {
  selectedRoot = "remote://unknown/alias/project";
  await act(async () => root?.render(createElement(AiComposerInput)));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(io.files).toEqual([]);
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("keeps sensitive file denial on citation delivery", async () => {
  await open();
  await act(async () => io.pick?.(".env"));
  expect(io.composer?.attachFileByPath).not.toHaveBeenCalled();
  expect(
    io.request.mock.calls.every(([, method]) => method === "fs.glob"),
  ).toBe(true);
});

it("does not publish an old index after a profile round trip", async () => {
  let finish!: (value: unknown) => void;
  io.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root?.render(createElement(AiComposerInput)));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(finish).toBeTypeOf("function");
  await act(async () => {
    usePreferencesStore.setState({
      sshConnections: [{ ...profile, host: "other.invalid" }],
    });
    usePreferencesStore.setState({ sshConnections: [profile] });
  });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(io.files).toEqual(["deep/file.ts"]);
  await act(async () =>
    finish({ hits: [{ rel: "retired.ts" }], truncated: false }),
  );
  expect(io.files).toEqual(["deep/file.ts"]);
  expect(
    leases.every((lease) => vi.mocked(lease.release).mock.calls.length === 1),
  ).toBe(true);
});

it.each([false, true])(
  "indexes and attaches a namespace file under an alias, StrictMode=%s",
  async (strict) => {
    await open(strict);
    expect(io.request).toHaveBeenCalledWith(17, "fs.glob", {
      cwd: ".",
      pattern: "**/*",
      maxResults: 2000,
    });
    await act(async () => io.pick?.("deep/file.ts"));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(attachments.map((attachment) => attachment.text)).toEqual([
      "content",
    ]);
    expect(io.request).toHaveBeenCalledWith(17, "fs.readFile", {
      path: "deep/file.ts",
    });
    expect(io.composer?.attachFileByPath).toHaveBeenCalledWith(
      `${namespace}/deep/file.ts`,
      { kind: "local" },
      expect.any(Function),
      expect.objectContaining({ profile, path: `${namespace}/deep/file.ts` }),
    );
    expect(io.invoke).not.toHaveBeenCalled();
    expect(
      leases.every((lease) => vi.mocked(lease.release).mock.calls.length === 1),
    ).toBe(true);
    await act(async () => {
      for (const frame of frames.splice(0)) frame(0);
    });
  },
);

it.each(["profile", "project"])(
  "refuses a cached picker after a synchronous %s round trip",
  async (mode) => {
    await open();
    const pick = io.pick;
    await act(async () => {
      if (mode === "profile") {
        usePreferencesStore.setState({
          sshConnections: [{ ...profile, host: "other.invalid" }],
        });
        usePreferencesStore.setState({ sshConnections: [profile] });
      } else {
        forgetRemoteProject(namespace);
        register();
      }
      pick?.("deep/file.ts");
    });
    expect(io.composer?.attachFileByPath).not.toHaveBeenCalled();
    expect(attachments).toEqual([]);
  },
);

it.each(["profile", "chat", "unmount"])(
  "discards a pending file after %s retirement",
  async (mode) => {
    await open();
    const request = io.request.getMockImplementation();
    let finish!: (value: unknown) => void;
    io.request.mockImplementation((id, method, params) =>
      method === "fs.readFile"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : request?.(id, method, params),
    );
    await act(async () => io.pick?.("deep/file.ts"));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(finish).toBeTypeOf("function");
    await act(async () => {
      if (mode === "profile") {
        usePreferencesStore.setState({
          sshConnections: [{ ...profile, host: "other.invalid" }],
        });
        usePreferencesStore.setState({ sshConnections: [profile] });
      } else if (mode === "chat")
        useChatStore.setState({ activeSessionId: "successor" });
      else {
        root?.unmount();
        root = null;
      }
      finish({ content: "retired", size: 7, mtime: 1 });
    });
    expect(attachments).toEqual([]);
    expect(
      leases.every((lease) => vi.mocked(lease.release).mock.calls.length === 1),
    ).toBe(true);
  },
);
