// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHarnessMemorySessions } from "@/modules/harness/lib/harnessMemorySessions";
import { useHarnessProjectEnvStore } from "@/modules/harness/lib/harnessEnvStore";
import type { WorkspaceEnv } from "@/modules/workspace/env";
import { createMemoryClient } from "@/modules/workspace-kit/lib/memoryClient";
import { createMemoryConversations } from "@/modules/workspace-kit/lib/memoryConversations";
import {
  createMemoryConversationPanel,
  type MemoryConversationPanelState,
} from "@/modules/workspace-kit/lib/memoryConversationPanel";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import ProjectMemoryPanel from "@/modules/workspace-kit/components/ProjectMemoryPanel";
import { RemoteSessionPool } from "@/modules/remote/sessionPool";
import type { RemoteRequest } from "@/modules/remote/client";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { captureRemoteMemorySource } from "@/modules/workspace-kit/lib/remoteMemorySource";
import {
  sendCodexTurn,
  stopCodexSession,
  __codexTestReset,
} from "@/modules/harness/lib/harness/codex";
import {
  sendClaudeTurn,
  stopClaudeSession,
  __claudeTestReset,
} from "@/modules/harness/lib/harness/claude";

const io = vi.hoisted(() => ({
  native: vi.fn(),
  request: vi.fn(),
  acquire: vi.fn(),
  subscribe: vi.fn(),
  snapshot: vi.fn(),
  spawn: vi.fn(),
  probe: vi.fn(),
  claudeMessages: [] as Record<string, unknown>[],
  line: null as ((line: string) => void) | null,
  messages: [] as {
    id: number;
    method: string;
    params?: Record<string, unknown>;
  }[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.native }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemote: io.request,
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: {
    acquire: io.acquire,
    subscribe: io.subscribe,
    snapshot: io.snapshot,
  },
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  deleteGeneratedImages: vi.fn(),
  saveGeneratedImage: vi.fn(),
}));
vi.mock("@/modules/harness/lib/harness/child", () => ({
  closeRetiredRawChildren: async () => {},
  resolveCodexBinary: async () => {
    throw new Error("Local binary resolution is forbidden");
  },
  resolveClaudeBinary: async () => {
    throw new Error("Local binary resolution is forbidden");
  },
  execChild: async () => {
    throw new Error("Local version probing is forbidden");
  },
  reserveRawChild(logicalSessionId: string) {
    let retired = false;
    let source: ReturnType<typeof captureRemoteMemorySource> | null = null;
    let line: ((value: string) => void) | null = null;
    return {
      nativeId: crypto.randomUUID(),
      logicalSessionId,
      get retired() {
        return retired;
      },
      async spawn(command: string, args: string[], cwd: string) {
        source ??= captureRemoteMemorySource({
          path: cwd,
          environment: { kind: "local" },
          source: "provider",
        });
        await io.spawn(command, args, cwd);
      },
      async probeRemote(command: string, cwd: string) {
        source = captureRemoteMemorySource({
          path: cwd,
          environment: { kind: "local" },
          source: "provider",
        });
        return io.probe(command, cwd);
      },
      assertMemorySource(key: string) {
        if (retired || !source || source.selectionKey !== key)
          throw new Error("Provider source changed");
        source.check();
      },
      watch(callback: (value: string) => void) {
        line = callback;
        io.line = callback;
        return () => {};
      },
      async write(payload: string) {
        if (retired) throw new Error("retired");
        const message = JSON.parse(payload);
        if (message.type) {
          io.claudeMessages.push(message);
          if (message.type === "control_request")
            queueMicrotask(() =>
              line?.(
                JSON.stringify({
                  type: "system",
                  subtype: "init",
                  session_id: "remote-claude-provider",
                }),
              ),
            );
          return;
        }
        io.messages.push(message);
        const result =
          message.method === "initialize"
            ? {}
            : message.method === "thread/start"
              ? { thread: { id: "remote-provider" } }
              : undefined;
        if (result)
          queueMicrotask(() =>
            line?.(JSON.stringify({ id: message.id, result })),
          );
      },
      async close() {
        retired = true;
        source?.dispose();
        if (io.line === line) io.line = null;
      },
    };
  },
}));

const profile = {
  id: "conversation-host",
  name: "Conversation host",
  host: "original.invalid",
  port: 22,
};
const root = "remote://voktty-ssh-conversation-host/project";
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/project",
  connection: profile,
  sessionId: 999,
};
const target = {
  path: root,
  environment: { kind: "local" as const },
  source: "harness:test",
};
const handle = { id: 1, token: "00000000-0000-4000-8000-000000000001" };
const selection = "00000000-0000-4000-8000-000000000003";
let pool: RemoteSessionPool;
let packetText: string;
let nextSession: number;
let managers: ReturnType<typeof createHarnessMemorySessions>[];
let conversations: MemoryConversation[];
let clients: ReturnType<typeof createMemoryClient>[];
let panels: ReturnType<typeof createMemoryConversationPanel>[];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function packet() {
  return {
    schema: 1,
    decision: {
      schema: 1,
      policy: "manual",
      contextAllowed: true,
      captureAllowed: false,
      reason: "KIT_MEMORY_READY",
    },
    packet: {
      schema: 1,
      projectKey: "a".repeat(64),
      instructionDigest: "b".repeat(64),
      digest: "c".repeat(64),
      bytes: new TextEncoder().encode(packetText).length,
      text: packetText,
      contentState: "initial",
    },
  };
}
function environment(env: WorkspaceEnv = ssh) {
  if (env.kind !== "ssh") throw new Error("Fixture requires SSH");
  useHarnessProjectEnvStore.setState({
    projects: {
      [root]: {
        identity: {
          projectId: root,
          profileId: env.connection.id,
          requestedRoot: "/project",
          resolvedRoot: env.root,
          automatic: false,
        },
        env,
        connecting: false,
        error: null,
      },
    },
  });
}
function capture(cwd = root, harness: "codex" | "gemini" | "claude" = "codex") {
  const manager = createHarnessMemorySessions();
  managers.push(manager);
  const owner = {};
  const conversation = manager.capture(
    owner,
    cwd,
    cwd,
    () => true,
    true,
    harness,
  );
  conversations.push(conversation);
  return { manager, owner, conversation };
}
function client(path = root, env: WorkspaceEnv = { kind: "local" }) {
  const result = createMemoryClient({
    path,
    environment: env,
    source: "review",
  });
  clients.push(result);
  return result;
}
async function bind(
  conversation: MemoryConversation,
  path = conversation.cwd,
  env = conversation.environment ?? { kind: "local" as const },
) {
  const presentation = client(path, env);
  const selected = await presentation.select(path, env);
  const review = await presentation.reviewTrust(selected);
  await conversation.bind({
    presentation,
    selection: selected,
    review,
    mode: "enabled",
  });
  return presentation;
}
async function enable(conversation: MemoryConversation) {
  const result = await conversation.read();
  if (!result?.packet || !conversation.delivery)
    throw new Error("Missing packet");
  await conversation.delivery.enable(result.packet, () => true);
  return result.packet;
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  io.messages = [];
  io.claudeMessages = [];
  io.probe.mockResolvedValue({ found: true, version: "2.1.312 (Claude Code)" });
  io.line = null;
  managers = [];
  conversations = [];
  clients = [];
  panels = [];
  nextSession = 7;
  packetText = "Remote project memory\r\nUnicode: ñ\r\n";
  useHarnessProjectEnvStore.setState({ projects: {} });
  usePreferencesStore.setState({ sshConnections: [profile] });
  rememberRemoteProject("voktty-ssh-conversation-host", {
    id: "project",
    name: "Project",
    cwd: "/project",
  });
  pool = new RemoteSessionPool({
    open: async () => ({
      session_id: nextSession++,
      workspace_root: "/project",
      architecture: "x86_64",
      helper_version: "1",
      capabilities: ["memory.manage"],
    }),
    close: async () => {},
    idleMs: 30_000,
    schedule: () => () => {},
  });
  io.acquire.mockImplementation((...args: Parameters<typeof pool.acquire>) =>
    pool.acquire(...args),
  );
  io.subscribe.mockImplementation((listener: () => void) =>
    pool.subscribe(listener),
  );
  io.snapshot.mockImplementation(() => pool.snapshot());
  io.request.mockImplementation(async (_id: number, request: RemoteRequest) => {
    const params = request.params ?? {};
    let result: unknown = null;
    if (params.operation === "open") result = handle;
    if (params.operation === "select") result = selection;
    if (params.operation === "inspect")
      result = {
        schema: 1,
        root: "/project",
        blockedCount: 0,
        scope: { schema: 1, state: "ready", ancestryComplete: true },
      };
    if (params.operation === "reviewTrust")
      result = { ...trustReply(params.revision as number), root: "/project" };
    if (params.operation === "contextOpen") result = { ...handle, id: 2 };
    if (params.operation === "contextBind")
      result = { schema: 1, root: "/project" };
    if (params.operation === "contextBindProject")
      result = { schema: 2, root: "/project", packet: packet().packet };
    if (params.operation === "contextRead") result = packet();
    return {
      protocol: 2,
      id: request.id,
      ok: true,
      result: { schema: 1, ok: true, result },
    };
  });
  io.native.mockImplementation(async (command, args) => {
    if (command === "project_memory_open") return handle;
    if (command === "project_memory_select") return selection;
    if (command === "project_memory_review_trust")
      return { ...trustReply(args.request.revision), root: "/project" };
  });
});
afterEach(async () => {
  await stopCodexSession("remote-conversation");
  __codexTestReset();
  await stopClaudeSession("remote-claude-conversation");
  __claudeTestReset();
  for (const panel of panels) await panel.dispose();
  for (const manager of managers) manager.dispose();
  await Promise.all(conversations.map((conversation) => conversation.close()));
  await Promise.all(clients.map((presentation) => presentation.close()));
  await pool.closeAll();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "binds and enables a remote conversation using its captured environment (connected=%s)",
  async (connected) => {
    if (connected) environment();
    const { conversation } = capture();
    const states: MemoryConversationPanelState[] = [];
    const panel = createMemoryConversationPanel(
      conversation,
      { kind: "local" },
      (state) => states.push(state),
    );
    panels.push(panel);
    expect(io.request).not.toHaveBeenCalled();
    await panel.review();
    expect(conversation.status()).toBe("ready");
    const prepared = states[states.length - 1];
    if (prepared.status !== "prepared" || !prepared.result.packet)
      throw new Error("Missing prepared packet");
    expect(conversation.delivery?.getSnapshot().root).toBe(root);
    expect(
      io.request.mock.calls.some(
        ([, request]) => request.params.operation === "reviewTrust",
      ),
    ).toBe(false);
    expect(conversation.delivery?.getSnapshot().enabled).toBe(true);
    expect(conversation.delivery?.getSnapshot().receipt).toBeNull();
    await panel.dispose();
    expect((await conversation.read())?.packet?.text).toBe(packetText);
    expect(io.request.mock.calls.every(([id]) => id === 7)).toBe(true);
    expect(io.native).not.toHaveBeenCalled();
  },
);

it("rejects a different SSH host at the same POSIX directory before allocating context", async () => {
  const manager = createMemoryConversations();
  const conversation = manager.capture(
    {},
    "/project",
    "/project",
    () => true,
    false,
    ssh,
  );
  conversations.push(conversation);
  const foreign: WorkspaceEnv = {
    ...ssh,
    kind: "ssh",
    root: "/project",
    connection: { ...profile, id: "foreign", host: "foreign.invalid" },
  };
  const presentation = client("/project", foreign);
  const selected = await presentation.select("/project", foreign);
  const review = await presentation.reviewTrust(selected);
  await expect(
    conversation.bind({
      presentation,
      selection: selected,
      review,
      mode: "enabled",
    }),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(conversation.status()).toBe("inactive");
  expect(
    io.request.mock.calls.some(
      ([, request]) => request.params.operation === "contextOpen",
    ),
  ).toBe(false);
  manager.dispose();
});

it.each(["legacy", "unsupported"])(
  "rejects an incompatible remote project binding (%s) without local or legacy fallback",
  async (kind) => {
    const { conversation } = capture();
    const original = io.request.getMockImplementation();
    io.request.mockImplementation(async (id, request) => {
      if (request.params.operation !== "contextBindProject")
        return original?.(id, request);
      return {
        protocol: 2,
        id: request.id,
        ok: true,
        result:
          kind === "legacy"
            ? { schema: 1, ok: true, result: { schema: 1, root: "/project" } }
            : { schema: 1, ok: false, error: { code: "unsupported" } },
      };
    });
    const states: MemoryConversationPanelState[] = [];
    const panel = createMemoryConversationPanel(
      conversation,
      { kind: "local" },
      (state) => states.push(state),
    );
    panels.push(panel);
    await panel.review();
    expect(conversation.status()).toBe("retired");
    expect(states.some((state) => state.status === "prepared")).toBe(false);
    expect(conversation.delivery?.getSnapshot().enabled).toBe(false);
    const operations = io.request.mock.calls.map(
      ([, request]) => request.params.operation,
    );
    expect(
      operations.filter((operation) => operation === "contextBindProject"),
    ).toHaveLength(1);
    expect(operations).toContain("contextClose");
    expect(operations).not.toContain("contextBind");
    expect(operations).not.toContain("reviewTrust");
    expect(io.request.mock.calls.every(([id]) => id === 7)).toBe(true);
    expect(io.native).not.toHaveBeenCalled();
  },
);

it("never accepts a local selection for an SSH conversation with an identical path", async () => {
  const manager = createMemoryConversations();
  const conversation = manager.capture(
    {},
    "/project",
    "/project",
    () => true,
    false,
    ssh,
  );
  conversations.push(conversation);
  const presentation = createNativeMemoryPresentation();
  clients.push(presentation);
  const selected = await presentation.select("/project", { kind: "local" });
  const review = await presentation.reviewTrust(selected);
  await expect(
    conversation.bind({
      presentation,
      selection: selected,
      review,
      mode: "enabled",
    }),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(
    io.native.mock.calls.some(
      ([command]) => command === "project_memory_context_open",
    ),
  ).toBe(false);
  manager.dispose();
});

it("retires accepted remote memory immediately when a saved profile changes and returns", async () => {
  const { conversation } = capture();
  await bind(conversation);
  await enable(conversation);
  const changed = vi.fn();
  conversation.subscribe(changed);
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.invalid" }],
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  expect(conversation.status()).toBe("retired");
  expect(changed).toHaveBeenCalledOnce();
  await expect(conversation.read()).rejects.toMatchObject({
    code: "cancelled",
  });
  await conversation.close();
  expect(
    io.request.mock.calls.filter(
      ([, request]) => request.params.operation === "contextClose",
    ),
  ).toHaveLength(1);
});

it("retires conversation ownership across an environment incarnation round trip", async () => {
  environment();
  const { manager, owner, conversation } = capture();
  await bind(conversation);
  environment({
    ...ssh,
    kind: "ssh",
    root: "/project",
    connection: profile,
    sessionId: 1000,
  });
  environment();
  expect(conversation.status()).toBe("retired");
  const fresh = manager.capture(owner, root, root, () => true, true, "codex");
  conversations.push(fresh);
  expect(fresh).not.toBe(conversation);
  expect(fresh.status()).toBe("inactive");
});

it("rejects a late packet after retirement and keeps delivery disabled", async () => {
  const { conversation } = capture();
  await bind(conversation);
  const gate = deferred<unknown>();
  const started = deferred<void>();
  const request = io.request.getMockImplementation();
  io.request.mockImplementation(async (id, frame) => {
    if (frame.params.operation === "contextRead") {
      started.resolve();
      return gate.promise;
    }
    return request?.(id, frame);
  });
  const reading = conversation.read();
  const rejected = expect(reading).rejects.toMatchObject({ code: "cancelled" });
  await started.promise;
  usePreferencesStore.setState({ sshConnections: [] });
  gate.resolve({
    protocol: 2,
    id: "stale",
    ok: true,
    result: { schema: 1, ok: true, result: packet() },
  });
  await rejected;
  expect(conversation.delivery?.getSnapshot().enabled).toBe(false);
  expect(conversation.delivery?.getSnapshot().receipt).toBeNull();
});

it("does not offer remote managed delivery to a provider without a remote transport", () => {
  expect(
    capture(root, "gemini").conversation.delivery?.getSnapshot().supported,
  ).toBe(false);
  expect(capture().conversation.delivery?.getSnapshot().supported).toBe(true);
});

it.each(["policy", "runtime"] as const)(
  "explains the SSH conversation's %s restriction without claiming a local limitation",
  async (restriction) => {
    const { conversation } = capture(
      root,
      restriction === "runtime" ? "gemini" : "codex",
    );
    await bind(conversation);
    if (restriction === "policy") {
      const original = io.request.getMockImplementation();
      io.request.mockImplementation(async (id, request) => {
        if (request.params.operation !== "contextRead")
          return original?.(id, request);
        const value = packet();
        return {
          protocol: 2,
          id: request.id,
          ok: true,
          result: {
            schema: 1,
            ok: true,
            result: {
              ...value,
              packet: null,
              decision: {
                ...value.decision,
                policy: "never",
                contextAllowed: false,
                reason: "KIT_MEMORY_POLICY_NEVER",
              },
            },
          },
        };
      });
    }
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const node = document.createElement("div");
    document.body.append(node);
    const view = createRoot(node);
    try {
      await act(async () =>
        view.render(
          createElement(ProjectMemoryPanel, { target, conversation }),
        ),
      );
      const read = [...node.querySelectorAll("button")].find(
        (button) => button.textContent === "projectMemory.conversationRead",
      );
      expect(read).toBeDefined();
      await act(async () => read?.click());
      const message =
        restriction === "policy"
          ? "conversationError"
          : "sshSettings.deliveryUnsupported";
      expect(node.textContent).toContain(`projectMemory.${message}`);

      expect(conversation.delivery?.getSnapshot().enabled).toBe(false);
      expect(io.native).not.toHaveBeenCalled();
    } finally {
      await act(async () => view.unmount());
      node.remove();
    }
  },
);

it("prepares and enables remote project context with one explicit gesture", async () => {
  environment();
  const { conversation } = capture();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const view = createRoot(node);
  const button = (label: string) => {
    const found = [...node.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label,
    );
    if (!found) throw new Error(`Missing button ${label}`);
    return found;
  };
  try {
    await act(async () =>
      view.render(createElement(ProjectMemoryPanel, { target, conversation })),
    );
    expect(
      io.request.mock.calls.some(
        ([, request]) => request.params.operation === "contextOpen",
      ),
    ).toBe(false);
    await act(async () => button("projectMemory.deliveryEnable").click());
    expect(node.querySelector('input[type="checkbox"]')).toBeNull();
    expect(node.textContent).toContain("projectMemory.conversationPrepared");
    expect(
      io.request.mock.calls.some(
        ([, request]) => request.params.operation === "reviewTrust",
      ),
    ).toBe(false);
    expect(node.textContent).toContain("projectMemory.deliveryEnabled");
    expect(conversation.delivery?.getSnapshot().receipt).toBeNull();
  } finally {
    await act(async () => view.unmount());
    node.remove();
  }
  expect((await conversation.read())?.packet?.text).toBe(packetText);
  expect(io.native).not.toHaveBeenCalled();
});

it("delivers host context through the Codex adapter and records acceptance only after provider ACK", async () => {
  environment();
  const { manager, owner, conversation } = capture();
  const presentation = await bind(conversation);
  await enable(conversation);
  await presentation.close();
  const source = manager.turnSource(owner, () => {});
  expect(source).toBeDefined();
  const sending = sendCodexTurn({
    sessionId: "remote-conversation",
    cwd: root,
    model: "codex:gpt-5.4",
    runtimeMode: "supervised",
    text: "User task",
    onEvent: () => {},
    projectMemory: source,
  });
  void sending.catch(() => undefined);
  await vi.waitFor(() =>
    expect(io.messages.some((message) => message.method === "turn/start")).toBe(
      true,
    ),
  );
  expect(io.spawn.mock.calls[0]?.[2]).toBe(root);
  expect(
    io.messages.find((message) => message.method === "thread/start")?.params
      ?.cwd,
  ).toBe("/project");
  const turn = io.messages.find((message) => message.method === "turn/start");
  if (!turn) throw new Error("Missing turn");
  expect(turn.params?.input).toEqual([
    { type: "text", text: packetText },
    { type: "text", text: "User task" },
  ]);
  expect(conversation.delivery?.getSnapshot().receipt).toBeNull();
  io.line?.(
    JSON.stringify({
      id: turn.id,
      result: { turn: { id: "turn", status: "inProgress" } },
    }),
  );
  await vi.waitFor(() =>
    expect(
      conversation.delivery?.getSnapshot().receipt?.providerSessionId,
    ).toBe("remote-provider"),
  );
  io.line?.(
    JSON.stringify({
      method: "turn/completed",
      params: {
        threadId: "remote-provider",
        turn: { id: "turn", status: "completed" },
      },
    }),
  );
  await sending;
  expect(conversation.delivery?.getSnapshot().receipt?.packet.text).toBe(
    packetText,
  );
  expect(io.native).not.toHaveBeenCalled();
});

it("refuses new host memory on an existing Codex process whose namespace string was reused", async () => {
  environment();
  const { manager, owner, conversation } = capture();
  const presentation = await bind(conversation);
  await enable(conversation);
  await presentation.close();
  const sending = sendCodexTurn({
    sessionId: "remote-conversation",
    cwd: root,
    model: "codex:gpt-5.4",
    runtimeMode: "supervised",
    text: "First",
    onEvent: () => {},
    projectMemory: manager.turnSource(owner, () => {}),
  });
  void sending.catch(() => undefined);
  await vi.waitFor(() =>
    expect(io.messages.some((message) => message.method === "turn/start")).toBe(
      true,
    ),
  );
  const turn = io.messages.find((message) => message.method === "turn/start");
  if (!turn) throw new Error("Missing turn");
  io.line?.(
    JSON.stringify({
      id: turn.id,
      result: { turn: { id: "turn", status: "inProgress" } },
    }),
  );
  io.line?.(
    JSON.stringify({
      method: "turn/completed",
      params: {
        threadId: "remote-provider",
        turn: { id: "turn", status: "completed" },
      },
    }),
  );
  await sending;
  const replacement = { ...profile, host: "replacement.invalid" };
  usePreferencesStore.setState({ sshConnections: [replacement] });
  environment({
    ...ssh,
    kind: "ssh",
    root: "/project",
    connection: replacement,
  });
  await conversation.close();
  const fresh = manager.capture(owner, root, root, () => true, true, "codex");
  conversations.push(fresh);
  const nextPresentation = await bind(fresh);
  await enable(fresh);
  await nextPresentation.close();
  await expect(
    sendCodexTurn({
      sessionId: "remote-conversation",
      cwd: root,
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      text: "Second",
      onEvent: () => {},
      projectMemory: manager.turnSource(owner, () => {}),
    }),
  ).rejects.toThrow("source changed");
  expect(io.spawn).toHaveBeenCalledOnce();
  expect(
    io.messages.filter((message) => message.method === "turn/start"),
  ).toHaveLength(1);
  expect(fresh.delivery?.getSnapshot().receipt).toBeNull();
});

it("verifies remote Claude replay and records only its exact echoed input", async () => {
  environment();
  const { manager, owner, conversation } = capture(root, "claude");
  const presentation = await bind(conversation);
  await enable(conversation);
  await presentation.close();
  const sending = sendClaudeTurn({
    sessionId: "remote-claude-conversation",
    cwd: root,
    model: "claude:sonnet",
    runtimeMode: "supervised",
    text: "Task",
    onEvent: () => {},
    projectMemory: manager.turnSource(owner, () => {}),
  });
  void sending.catch(() => undefined);
  await vi.waitFor(() =>
    expect(io.claudeMessages.some((message) => message.type === "user")).toBe(
      true,
    ),
  );
  expect(io.probe).toHaveBeenCalledExactlyOnceWith("claude", root);
  expect(io.spawn.mock.calls[0]?.[1]).toContain("--replay-user-messages");
  expect(io.spawn.mock.calls[0]?.[2]).toBe(root);
  const message = io.claudeMessages.find(
    (candidate) => candidate.type === "user",
  );
  if (!message) throw new Error("Missing user input");
  expect((message.message as { content: unknown[] }).content).toEqual([
    { type: "text", text: packetText },
    { type: "text", text: "Task" },
  ]);
  expect(conversation.delivery?.getSnapshot().receipt).toBeNull();
  const echoed = { ...message };
  delete echoed.client_composed;
  io.line?.(
    JSON.stringify({ ...echoed, isReplay: true, parent_tool_use_id: null }),
  );
  await vi.waitFor(() =>
    expect(conversation.delivery?.getSnapshot().receipt).toMatchObject({
      adapter: "claude",
    }),
  );
  io.line?.(
    JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "remote-claude-provider",
      result: "done",
    }),
  );
  await sending;
  expect(conversation.delivery?.getSnapshot().receipt?.packet.text).toBe(
    packetText,
  );
  expect(io.native).not.toHaveBeenCalled();
});

it("rejects old remote Claude versions without starting a process or delivering memory", async () => {
  const { manager, owner, conversation } = capture(root, "claude");
  await bind(conversation);
  await enable(conversation);
  io.probe.mockResolvedValueOnce({ found: true, version: "2.1.311" });
  await expect(
    sendClaudeTurn({
      sessionId: "remote-claude-conversation",
      cwd: root,
      model: "claude:sonnet",
      runtimeMode: "supervised",
      text: "Task",
      onEvent: () => {},
      projectMemory: manager.turnSource(owner, () => {}),
    }),
  ).rejects.toThrow("2.1.312");
  expect(io.spawn).not.toHaveBeenCalled();
  expect(conversation.delivery?.getSnapshot().receipt).toBeNull();
  expect(io.native).not.toHaveBeenCalled();
});
