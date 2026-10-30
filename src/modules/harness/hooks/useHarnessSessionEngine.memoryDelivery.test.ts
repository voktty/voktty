// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHarnessSessionEngine } from "@/modules/harness/hooks/useHarnessSessionEngine";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";
import type { HarnessMemorySession } from "@/modules/harness/lib/harnessMemorySessions";
import { qualifyHarnessMemorySession } from "@/modules/harness/lib/harnessMemorySessions";
import type { Session } from "@/modules/harness/lib/session";
import {
  registerHarness,
  resetHarnessIdlePark,
} from "@/modules/harness/lib/harness/registry";
import {
  __codexTestReset,
  sendCodexTurn,
  steerCodexTurn,
  cancelCodexTurn,
  stopCodexSession,
  forgetCodexSession,
  bindCodexSession,
  rewindCodexLastTurn,
} from "@/modules/harness/lib/harness/codex";
import {
  __agyTestReset,
  stopAgySession,
} from "@/modules/harness/lib/harness/agy";
import { agyAdapter } from "@/modules/harness/lib/harness/agyAdapter";
import { MemoryConversation } from "@/modules/workspace-kit/components/MemoryConversation";
import { t } from "@/modules/i18n";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  attachments: vi.fn(),
  version: vi.fn(async () => "1.1.15"),
  messages: [] as {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    event?: string;
    message?: { content: unknown };
  }[],
  line: null as null | ((line: string) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/modules/harness/lib/harness", async () => ({
  ...(await import("@/modules/harness/lib/harness/registry")),
  ...(await import("@/modules/harness/lib/harness/apply")),
}));
vi.mock("@/modules/harness/lib/harness/child", () => ({
  closeRetiredRawChildren: async () => {},
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  resolveGeminiBinary: async () => ({ path: "/fake/agy" }),
  execChild: mocks.version,
  reserveRawChild(logicalSessionId: string) {
    let retired = false;
    let callback: ((line: string) => void) | null = null;
    return {
      nativeId: crypto.randomUUID(),
      logicalSessionId,
      get retired() {
        return retired;
      },
      watch(line: (value: string) => void) {
        callback = line;
        mocks.line = line;
        return () => {};
      },
      spawn: async () => {},
      async write(payload: string) {
        if (retired) throw new Error("retired");
        const message = JSON.parse(payload);
        mocks.messages.push(message);
        const result =
          message.method === "initialize" ||
          message.method === "turn/interrupt" ||
          message.method === "thread/revert"
            ? {}
            : message.method === "thread/start" ||
                message.method === "thread/resume"
              ? { thread: { id: "provider" } }
              : undefined;
        if (result)
          queueMicrotask(() =>
            callback?.(JSON.stringify({ id: message.id, result })),
          );
      },
      close: async () => {
        retired = true;
        if (mocks.line === callback) mocks.line = null;
      },
    };
  },
}));
vi.mock("@/modules/harness/lib/checkpoint", () => ({
  beginSessionTurn: async () => {},
  syncSessionCheckpoint: async () => {},
  prepareSessionCheckpoint: async () => {},
  captureSessionCheckpoint: async () => {},
  notifyReviewChanged: () => {},
}));
vi.mock("@/modules/harness/lib/attachments", () => ({
  displayAttachments: (value: unknown) => value,
  prepareAttachments: mocks.attachments,
}));
vi.mock("@/modules/harness/lib/skills", () => ({
  warmPiSkills: () => {},
  applySkillsToTurn: async (text: string) => text,
}));
vi.mock("@/modules/harness/lib/notes", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/notes")>()),
  applyNotesToTurn: async (text: string) => text,
}));
vi.mock("@/modules/harness/lib/dockBadge", () => ({ syncDockBadge: () => {} }));
vi.mock("@/modules/harness/lib/sounds", () => ({ playCue: () => {} }));
vi.mock("@/modules/harness/lib/fileWatch", () => ({
  nudgeWatchedFiles: () => {},
}));
vi.mock("@/modules/harness/lib/fileTree", () => ({
  notifyDirsChanged: () => {},
  subscribeDirsChanged: () => () => {},
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  notifyGitChanged: () => {},
  listProjectFiles: async () => [],
  saveGeneratedImage: vi.fn(),
  deleteGeneratedImages: vi.fn(),
}));

let roots: Root[];
let scopes: HarnessMemorySession[];
let panels: ReturnType<typeof createNativeMemoryPresentation>[];
function packet() {
  const text = "PROJECT MEMORY (.voktty)\noriginal context";
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
      text,
      bytes: new TextEncoder().encode(text).length,
      contentState: "available",
    },
  };
}
function chat(patch: Partial<Session> = {}): Session {
  return {
    id: "source",
    harness: "codex",
    model: "codex:gpt-5.4",
    modelSettings: {},
    runtimeMode: "supervised",
    cwd: "/project",
    title: "named",
    blocks: [
      { id: "old", role: "user", text: "old task", providerTurnId: "old-turn" },
    ],
    ...patch,
  };
}
function mount(patch: Partial<Session> = {}) {
  let engine!: ReturnType<typeof useHarnessSessionEngine>;
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  function Host() {
    engine = useHarnessSessionEngine({
      initialSessions: () => [chat(patch)],
      isForeground: () => true,
      isRemoving: () => false,
      isSwitching: () => false,
    });
    return null;
  }
  act(() => root.render(createElement(StrictMode, null, createElement(Host))));
  return () => engine;
}
async function prepare(
  engine: ReturnType<typeof useHarnessSessionEngine>,
  enable = true,
) {
  const scope = engine.captureMemorySession("source");
  if (!scope?.delivery) throw new Error("Missing memory scope");
  scopes.push(scope);
  const panel = createNativeMemoryPresentation();
  panels.push(panel);
  const selection = await panel.select(scope.cwd, { kind: "local" });
  const review = await panel.reviewTrust(selection);
  await act(async () => {
    await scope.bind({
      presentation: panel,
      selection,
      review,
      mode: "enabled",
    });
  });
  const result = await scope.read();
  if (!result?.packet) throw new Error("Missing packet");
  if (enable) await scope.delivery.enable(result.packet, () => true);
  return { scope, packet: result.packet };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function notify(method: string, params: unknown) {
  mocks.line?.(JSON.stringify({ method, params }));
}
async function request(method = "turn/start", count = 1) {
  await act(async () => {
    await vi.waitFor(() =>
      expect(
        mocks.messages.filter((message) => message.method === method),
      ).toHaveLength(count),
    );
  });
  return mocks.messages.filter((message) => message.method === method)[
    count - 1
  ];
}
async function finish(
  engine: () => ReturnType<typeof useHarnessSessionEngine>,
  method = "turn/start",
) {
  const message = [...mocks.messages]
    .reverse()
    .find((message) => message.method === method);
  if (!message) throw new Error("Missing RPC");
  await act(async () => {
    mocks.line?.(
      JSON.stringify({
        id: message.id,
        result: { turn: { id: "turn", status: "inProgress" } },
      }),
    );
    await Promise.resolve();
    notify("turn/completed", {
      threadId: "provider",
      turn: { id: "turn", status: "completed" },
    });
    await vi.dynamicImportSettled();
  });
  expect(engine().readSession("source")?.busy).toBe(false);
}
beforeEach(() => {
  roots = [];
  scopes = [];
  panels = [];
  mocks.messages = [];
  mocks.line = null;
  mocks.version.mockReset().mockResolvedValue("1.1.15");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.attachments.mockReset().mockImplementation(async (value) => value);
  mocks.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "project_memory_open") return { id: 1, token: "panel" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_review_trust")
      return trustReply(args.request.revision);
    if (command === "project_memory_context_open")
      return { id: 2, token: "00000000-0000-4000-8000-000000000009" };
    if (command === "project_memory_context_bind")
      return { schema: 1, root: trustReply().root };
    if (command === "project_memory_context_read") return packet();
  });
  registerHarness({
    id: "codex",
    live: true,
    projectMemory: "managed-turn",
    sendTurn: sendCodexTurn,
    steerTurn: steerCodexTurn,
    cancelTurn: cancelCodexTurn,
    stopSession: stopCodexSession,
    forgetSession: forgetCodexSession,
    bindSession: bindCodexSession,
    rewindLastTurn: rewindCodexLastTurn,
    respondApproval: () => {},
  });
  registerHarness(agyAdapter);
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
    await stopCodexSession("source");
    await stopAgySession("source");
    await Promise.all(scopes.map((scope) => scope.close()));
    await Promise.all(panels.map((panel) => panel.close()));
  });
  __codexTestReset();
  __agyTestReset();
  resetHarnessIdlePark();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each(["normal", "plan", "build", "edited resend"])(
  "delivers enabled memory through the actual engine and Codex RPC for %s",
  async (kind) => {
    const engine = mount(
      kind === "build"
        ? {
            blocks: [
              {
                id: "plan",
                role: "plan",
                text: "approved plan",
                plan: { status: "ready" },
              },
            ],
          }
        : {},
    );
    let prepared!: Awaited<ReturnType<typeof prepare>>;
    await act(async () => {
      prepared = await prepare(engine());
    });
    expect(engine().readSession("source")?.providerAccountId).toBe("default");
    await act(async () => {
      if (kind === "build") engine().onBuildPlan("source", "plan");
      else
        engine().onSubmit(
          "source",
          "original task",
          [],
          kind === "plan"
            ? { intent: "plan" }
            : kind === "edited resend"
              ? { resendEdited: true }
              : undefined,
        );
    });
    const message = await request();
    expect(message.params?.input).toEqual([
      expect.objectContaining({ type: "text", text: prepared.packet.text }),
      expect.objectContaining({ type: "text" }),
    ]);
    expect(prepared.scope.delivery?.getSnapshot().receipt).toBeNull();
    await finish(engine);
    expect(prepared.scope.delivery?.getSnapshot().receipt?.packet.text).toBe(
      prepared.packet.text,
    );
    expect(JSON.stringify(engine().sessions)).not.toContain(
      prepared.packet.text,
    );
  },
);

it.each(["absent", "prepared only"])(
  "preserves original input and does not read memory when %s",
  async (kind) => {
    const engine = mount();
    if (kind === "prepared only")
      await act(async () => {
        await prepare(engine(), false);
      });
    const before = mocks.invoke.mock.calls.filter(
      ([command]) => command === "project_memory_context_read",
    ).length;
    await act(async () => engine().onSubmit("source", "unchanged task"));
    expect((await request()).params?.input).toEqual([
      { type: "text", text: "unchanged task" },
    ]);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "project_memory_context_read",
      ),
    ).toHaveLength(before);
    await finish(engine);
  },
);

it("captures delivery consent at submission instead of adopting an activation during preparation", async () => {
  const engine = mount();
  let prepared!: Awaited<ReturnType<typeof prepare>>;
  await act(async () => {
    prepared = await prepare(engine(), false);
  });
  const attachments = deferred<[]>();
  mocks.attachments.mockReturnValueOnce(attachments.promise);
  await act(async () => engine().onSubmit("source", "old input"));
  await act(async () => {
    await prepared.scope.delivery?.enable(prepared.packet, () => true);
    attachments.resolve([]);
  });
  expect((await request()).params?.input).toEqual([
    { type: "text", text: "old input" },
  ]);
  await finish(engine);
  await act(async () => engine().onSubmit("source", "next input"));
  expect((await request("turn/start", 2)).params?.input).toEqual([
    { type: "text", text: prepared.packet.text },
    { type: "text", text: "next input" },
  ]);
  await finish(engine);
});

it("delivers through the engine's active-turn follow-up path", async () => {
  const engine = mount();
  await act(async () => engine().onSubmit("source", "start"));
  const start = await request();
  await act(async () => {
    mocks.line?.(
      JSON.stringify({
        id: start.id,
        result: { turn: { id: "turn", status: "inProgress" } },
      }),
    );
    notify("turn/started", {
      threadId: "provider",
      turn: { id: "turn", status: "inProgress" },
    });
    await prepare(engine());
  });
  await act(async () =>
    engine().onSubmit("source", "follow-up", [], { followUpBehavior: "steer" }),
  );
  expect((await request("turn/steer")).params?.input).toEqual([
    { type: "text", text: packet().packet.text },
    { type: "text", text: "follow-up" },
  ]);
  const steer = [...mocks.messages]
    .reverse()
    .find((message) => message.method === "turn/steer");
  await act(async () => {
    mocks.line?.(JSON.stringify({ id: steer?.id, result: { turnId: "turn" } }));
    notify("turn/completed", {
      threadId: "provider",
      turn: { id: "turn", status: "completed" },
    });
  });
});

it.each(["context roundtrip", "stop", "disable"])(
  "suppresses a late provider request after %s during native memory reading",
  async (kind) => {
    const engine = mount();
    let prepared!: Awaited<ReturnType<typeof prepare>>;
    await act(async () => {
      prepared = await prepare(engine());
    });
    const read = deferred<unknown>();
    const original = mocks.invoke.getMockImplementation();
    mocks.invoke.mockImplementation((command, args) =>
      command === "project_memory_context_read"
        ? read.promise
        : original?.(command, args),
    );
    const before = mocks.invoke.mock.calls.length;
    await act(async () => engine().onSubmit("source", "stale input"));
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          mocks.invoke.mock.calls
            .slice(before)
            .some(([command]) => command === "project_memory_context_read"),
        ).toBe(true),
      );
    });
    await act(async () => {
      if (kind === "stop") engine().onStop("source");
      else if (kind === "disable") await prepared.scope.close();
      else
        engine().applySessionDeltas(
          [
            {
              kind: "update",
              id: "source",
              update: (session) => ({ ...session, cwd: "/other" }),
            },
            {
              kind: "update",
              id: "source",
              update: (session) => ({ ...session, cwd: "/project" }),
            },
          ],
          "immediate",
        );
      read.resolve(packet());
    });
    expect(
      mocks.messages.some((message) => message.method === "turn/start"),
    ).toBe(false);
  },
);

it("uses explicit consent when a queued input is actually dispatched", async () => {
  const engine = mount({ busy: true });
  await act(async () =>
    engine().onSubmit("source", "queued task", [], {
      followUpBehavior: "queue",
    }),
  );
  expect(mocks.messages).toEqual([]);
  await act(async () => {
    await prepare(engine());
    engine().updateSession(
      "source",
      (session) => ({ ...session, busy: false }),
      "immediate",
    );
  });
  expect((await request()).params?.input).toEqual([
    { type: "text", text: packet().packet.text },
    { type: "text", text: "queued task" },
  ]);
  await finish(engine);
});

it("keeps engine-owned delivery after the enabling view's permission retires", async () => {
  const engine = mount();
  let prepared!: Awaited<ReturnType<typeof prepare>>;
  await act(async () => {
    prepared = await prepare(engine(), false);
  });
  let current = true;
  const view = qualifyHarnessMemorySession(prepared.scope, () => current);
  await act(async () => {
    await view.delivery?.enable(prepared.packet, () => true);
  });
  current = false;
  expect(view.delivery?.getSnapshot().enabled).toBe(false);
  await act(async () => engine().onSubmit("source", "headless task"));
  expect((await request()).params?.input).toEqual([
    { type: "text", text: prepared.packet.text },
    { type: "text", text: "headless task" },
  ]);
  await finish(engine);
  expect(
    prepared.scope.delivery?.getSnapshot().receipt?.providerSessionId,
  ).toBe("provider");
});

it("blocks an explicitly enabled turn after native policy revocation", async () => {
  const engine = mount();
  await act(async () => {
    await prepare(engine());
  });
  const original = mocks.invoke.getMockImplementation();
  mocks.invoke.mockImplementation((command, args) =>
    command === "project_memory_context_read"
      ? Promise.resolve({
          schema: 1,
          decision: {
            schema: 1,
            policy: "never",
            contextAllowed: false,
            captureAllowed: false,
            reason: "KIT_MEMORY_POLICY_NEVER",
          },
          packet: null,
        })
      : original?.(command, args),
  );
  await act(async () => {
    engine().onSubmit("source", "blocked task");
    await vi.dynamicImportSettled();
  });
  expect(
    mocks.messages.some((message) => message.method === "turn/start"),
  ).toBe(false);
  expect(engine().readSession("source")?.busy).toBe(false);
  expect(
    engine()
      .readSession("source")
      ?.blocks.some((block) => block.text.includes("KIT_MEMORY_POLICY_NEVER")),
  ).toBe(true);
});

const agySession: Partial<Session> = {
  harness: "gemini",
  model: "gemini:gemini-3.8-flash",
};
async function agyInput(count = 1) {
  await act(async () => {
    await vi.waitFor(() =>
      expect(
        mocks.messages.filter((message) => message.event === "user"),
      ).toHaveLength(count),
    );
  });
  return mocks.messages.filter((message) => message.event === "user")[count - 1]
    .message?.content;
}
async function finishAgy(
  engine: () => ReturnType<typeof useHarnessSessionEngine>,
  numTurns = 1,
  nextInput?: number,
) {
  await act(async () => {
    mocks.line?.(
      JSON.stringify({
        event: "result",
        result: {
          status: "SUCCESS",
          conversation_id: "agy-provider",
          num_turns: numTurns,
        },
      }),
    );
    await vi.dynamicImportSettled();
  });
  if (nextInput !== undefined) await agyInput(nextInput);
  expect(engine().readSession("source")?.busy).toBe(nextInput !== undefined);
}

it.each(["normal", "plan", "build"])(
  "delivers explicitly enabled memory through the real AGY adapter and engine for %s",
  async (kind) => {
    const engine = mount({
      ...agySession,
      ...(kind === "build"
        ? {
            blocks: [
              {
                id: "plan",
                role: "plan" as const,
                text: "approved plan",
                plan: { status: "ready" as const },
              },
            ],
          }
        : {}),
    });
    let prepared!: Awaited<ReturnType<typeof prepare>>;
    await act(async () => {
      prepared = await prepare(engine());
    });
    expect(prepared.scope.delivery?.getSnapshot().supported).toBe(true);
    expect(mocks.messages).toEqual([]);
    await act(async () => {
      if (kind === "build") engine().onBuildPlan("source", "plan");
      else
        engine().onSubmit(
          "source",
          "original task",
          [],
          kind === "plan" ? { intent: "plan" } : undefined,
        );
    });
    expect(await agyInput()).toEqual([
      { type: "text", text: prepared.packet.text },
      expect.objectContaining({ type: "text" }),
    ]);
    expect(prepared.scope.delivery?.getSnapshot().receipt).toBeNull();
    await finishAgy(engine);
    expect(prepared.scope.delivery?.getSnapshot().receipt).toMatchObject({
      adapter: "agy",
      providerSessionId: "agy-provider",
      packet: prepared.packet,
    });
    expect(engine().readSession("source")?.providerSessionId).toBe(
      "agy-provider",
    );
    expect(JSON.stringify(engine().sessions)).not.toContain(
      prepared.packet.text,
    );
  },
);

it.each(["absent", "prepared only"])(
  "preserves AGY input and avoids memory IO when %s",
  async (kind) => {
    const engine = mount(agySession);
    if (kind === "prepared only")
      await act(async () => {
        await prepare(engine(), false);
      });
    const reads = mocks.invoke.mock.calls.filter(
      ([command]) => command === "project_memory_context_read",
    ).length;
    await act(async () => engine().onSubmit("source", "unchanged task"));
    expect(await agyInput()).toBe("unchanged task");
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "project_memory_context_read",
      ),
    ).toHaveLength(reads);
    await finishAgy(engine);
  },
);

it("preserves the AGY steering restriction and delivers fresh memory for an explicitly queued follow-up", async () => {
  const engine = mount(agySession);
  let prepared!: Awaited<ReturnType<typeof prepare>>;
  await act(async () => {
    prepared = await prepare(engine());
    engine().onSubmit("source", "first task");
  });
  await agyInput();
  await act(async () =>
    engine().onSubmit("source", "follow-up", [], { followUpBehavior: "steer" }),
  );
  expect(
    mocks.messages.filter((message) => message.event === "user"),
  ).toHaveLength(1);
  expect(engine().readSession("source")?.queuedMessages ?? []).toEqual([]);
  await act(async () =>
    engine().onSubmit("source", "follow-up", [], { followUpBehavior: "queue" }),
  );
  expect(engine().readSession("source")?.queuedMessages).toHaveLength(1);
  await finishAgy(engine, 1, 2);
  expect(await agyInput(2)).toEqual([
    { type: "text", text: prepared.packet.text },
    { type: "text", text: "follow-up" },
  ]);
  await finishAgy(engine, 2);
  expect(mocks.version).toHaveBeenCalledTimes(1);
});

it("does not admit an unsupported edited resend or read its memory", async () => {
  const engine = mount(agySession);
  let prepared!: Awaited<ReturnType<typeof prepare>>;
  await act(async () => {
    prepared = await prepare(engine());
  });
  const reads = mocks.invoke.mock.calls.filter(
    ([command]) => command === "project_memory_context_read",
  ).length;
  await act(async () =>
    engine().onSubmit("source", "edited task", [], { resendEdited: true }),
  );
  expect(mocks.messages).toEqual([]);
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "project_memory_context_read",
    ),
  ).toHaveLength(reads);
  expect(prepared.scope.delivery?.getSnapshot().receipt).toBeNull();
});

it.each(["context roundtrip", "stop", "disable"])(
  "suppresses an AGY input after %s during the native memory read",
  async (kind) => {
    const engine = mount(agySession);
    let prepared!: Awaited<ReturnType<typeof prepare>>;
    await act(async () => {
      prepared = await prepare(engine());
    });
    const read = deferred<unknown>();
    const original = mocks.invoke.getMockImplementation();
    mocks.invoke.mockImplementation((command, args) =>
      command === "project_memory_context_read"
        ? read.promise
        : original?.(command, args),
    );
    const before = mocks.invoke.mock.calls.length;
    await act(async () => engine().onSubmit("source", "stale input"));
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          mocks.invoke.mock.calls
            .slice(before)
            .some(([command]) => command === "project_memory_context_read"),
        ).toBe(true),
      );
      if (kind === "stop") engine().onStop("source");
      else if (kind === "disable") await prepared.scope.close();
      else
        engine().applySessionDeltas(
          [
            {
              kind: "update",
              id: "source",
              update: (session) => ({ ...session, cwd: "/other" }),
            },
            {
              kind: "update",
              id: "source",
              update: (session) => ({ ...session, cwd: "/project" }),
            },
          ],
          "immediate",
        );
      read.resolve(packet());
      await vi.dynamicImportSettled();
    });
    expect(mocks.messages.some((message) => message.event === "user")).toBe(
      false,
    );
    expect(prepared.scope.delivery?.getSnapshot().receipt).toBeNull();
  },
);

it("captures AGY consent at submission instead of adopting a later activation", async () => {
  const engine = mount(agySession);
  let prepared!: Awaited<ReturnType<typeof prepare>>;
  await act(async () => {
    prepared = await prepare(engine(), false);
  });
  const attachments = deferred<[]>();
  mocks.attachments.mockReturnValueOnce(attachments.promise);
  await act(async () => engine().onSubmit("source", "old input"));
  await act(async () => {
    await prepared.scope.delivery?.enable(prepared.packet, () => true);
    attachments.resolve([]);
  });
  expect(await agyInput()).toBe("old input");
  await finishAgy(engine);
  await act(async () => engine().onSubmit("source", "new input"));
  expect(await agyInput(2)).toEqual([
    { type: "text", text: prepared.packet.text },
    { type: "text", text: "new input" },
  ]);
  await finishAgy(engine, 2);
});

it("keeps AGY version failures actionable without a false input or memory receipt", async () => {
  const engine = mount(agySession);
  let prepared!: Awaited<ReturnType<typeof prepare>>;
  await act(async () => {
    prepared = await prepare(engine());
  });
  mocks.version.mockResolvedValue("1.1.7");
  await act(async () => {
    engine().onSubmit("source", "task");
    await vi.dynamicImportSettled();
  });
  expect(mocks.messages).toEqual([]);
  expect(prepared.scope.delivery?.getSnapshot().receipt).toBeNull();
  expect(engine().readSession("source")?.busy).toBe(false);
  expect(
    engine()
      .readSession("source")
      ?.blocks.some((block) => block.text.includes("1.1.15 or newer")),
  ).toBe(true);
});

it("activates AGY through the shared panel, displays only acknowledged input and disables future delivery", async () => {
  const engine = mount(agySession);
  let prepared!: Awaited<ReturnType<typeof prepare>>;
  await act(async () => {
    prepared = await prepare(engine(), false);
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(MemoryConversation, {
        conversation: prepared.scope,
        environment: { kind: "local" },
      }),
    ),
  );
  const button = (key: string) => {
    const found = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === t(key),
    );
    if (!found) throw new Error(`Missing button ${key}`);
    return found;
  };
  await act(async () => button("projectMemory.conversationRead").click());
  expect(container.textContent).toContain("24 KiB");
  expect(container.textContent).toContain("1.1.15");
  expect(prepared.scope.delivery?.getSnapshot().enabled).toBe(false);
  await act(async () => button("projectMemory.deliveryEnable").click());
  expect(prepared.scope.delivery?.getSnapshot().enabled).toBe(true);
  expect(mocks.messages).toEqual([]);
  expect(mocks.version).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain(
    t("projectMemory.deliveryLastAccepted"),
  );
  await act(async () => engine().onSubmit("source", "task"));
  await agyInput();
  expect(container.textContent).not.toContain(
    t("projectMemory.deliveryLastAccepted"),
  );
  await finishAgy(engine);
  expect(container.textContent).toContain(
    t("projectMemory.deliveryLastAccepted"),
  );
  expect(container.textContent).toContain("agy-provider");
  await act(async () => button("projectMemory.conversationDisable").click());
  const reads = mocks.invoke.mock.calls.filter(
    ([command]) => command === "project_memory_context_read",
  ).length;
  await act(async () => engine().onSubmit("source", "without new memory"));
  expect(await agyInput(2)).toBe("without new memory");
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "project_memory_context_read",
    ),
  ).toHaveLength(reads);
  await finishAgy(engine, 2);
});

it("blocks AGY delivery after native memory policy revocation", async () => {
  const engine = mount(agySession);
  let prepared!: Awaited<ReturnType<typeof prepare>>;
  await act(async () => {
    prepared = await prepare(engine());
  });
  const original = mocks.invoke.getMockImplementation();
  mocks.invoke.mockImplementation((command, args) =>
    command === "project_memory_context_read"
      ? Promise.resolve({
          schema: 1,
          decision: {
            schema: 1,
            policy: "never",
            contextAllowed: false,
            captureAllowed: false,
            reason: "KIT_MEMORY_POLICY_NEVER",
          },
          packet: null,
        })
      : original?.(command, args),
  );
  await act(async () => {
    engine().onSubmit("source", "blocked task");
    await vi.dynamicImportSettled();
  });
  expect(mocks.messages).toEqual([]);
  expect(prepared.scope.delivery?.getSnapshot().receipt).toBeNull();
  expect(engine().readSession("source")?.busy).toBe(false);
  expect(
    engine()
      .readSession("source")
      ?.blocks.some((block) => block.text.includes("KIT_MEMORY_POLICY_NEVER")),
  ).toBe(true);
});
