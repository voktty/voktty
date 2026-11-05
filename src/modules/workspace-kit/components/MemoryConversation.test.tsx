// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createHarnessMemorySessions,
  type HarnessMemorySession,
} from "@/modules/harness/lib/harnessMemorySessions";
import { captureHarnessMemoryConversation } from "@/modules/harness/lib/harnessMemoryConversation";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { newTab } from "@/modules/harness/lib/layout";
import { ProjectMemoryButton } from "@/modules/workspace-kit/components/ProjectMemoryButton";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";
import type { MemoryConversationCapture } from "@/modules/workspace-kit/lib/memoryConversation";
import { createMemoryConversationPanel } from "@/modules/workspace-kit/lib/memoryConversationPanel";

const { invoke, writeText } = vi.hoisted(() => ({
  invoke: vi.fn(),
  writeText: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));
vi.mock("@/modules/i18n", () => ({
  t: (key: string) => key,
  useTranslation: () => ({ t: (key: string) => key }),
}));
let root: Root;
let container: HTMLDivElement;
let scopes: HarnessMemorySession[];
let captures: MemoryConversationCapture[];
function packet(reason = "KIT_MEMORY_READY") {
  return {
    schema: 1,
    decision: {
      schema: 1,
      policy: reason === "KIT_MEMORY_POLICY_NEVER" ? "never" : "manual",
      contextAllowed: reason === "KIT_MEMORY_READY",
      captureAllowed: false,
      reason,
    },
    packet:
      reason === "KIT_MEMORY_READY"
        ? {
            schema: 1,
            projectKey: "a".repeat(64),
            instructionDigest: "b".repeat(64),
            digest: "c".repeat(64),
            bytes: 28,
            text: "<script>context</script> ñ",
            contentState: "initial",
          }
        : null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function button(label: string) {
  const value = [...document.querySelectorAll("button")].find(
    (button) =>
      button.getAttribute("aria-label") === label ||
      button.textContent === label,
  );
  if (!value) throw new Error(`Missing button ${label}`);
  return value;
}
async function click(label: string) {
  await act(async () => {
    button(label).click();
    await vi.dynamicImportSettled();
  });
}
async function open() {
  await act(async () => {
    button("projectMemory.title").click();
    await import("@/modules/workspace-kit/components/ProjectMemoryPanel");
  });
}
async function review() {
  await click("projectMemory.conversationReview");
  expect(button("projectMemory.conversationPrepare").disabled).toBe(true);
  const checkbox = document.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (!checkbox) throw new Error("Missing reviewed consent");
  await act(async () => checkbox.click());
}
async function mount(supportsDelivery = false) {
  const manager = createHarnessMemorySessions();
  const owner = {};
  const scope = manager.capture(
    owner,
    "/project",
    "/project/worktree",
    () => true,
    supportsDelivery,
  );
  scopes.push(scope);
  const views = createHarnessWindowViews();
  const tab = newTab("source");
  const input = {
    tabs: [tab],
    activeTabId: tab.id,
    projectCwd: "/project",
    projectTerminals: [],
    projectReturnMemory: new Map<string, string>(),
    report: {
      referencedSessionIds: ["source"],
      foregroundSessionIds: ["source"],
      activeSessionId: "source",
    },
  };
  const view = views.register(1, input);
  views.select(1);
  const captureMemorySession = vi.fn(() => scope);
  const capture = vi.fn(() => {
    const receipt = captureHarnessMemoryConversation(
      { captureMemorySession },
      views,
      1,
      "/project",
      { isCurrent: () => true, subscribe: () => () => undefined },
    );
    if (receipt) captures.push(receipt);
    return receipt;
  });
  await act(async () =>
    root.render(
      <StrictMode>
        <ProjectMemoryButton
          target={{
            path: "/project/browsed",
            environment: { kind: "local" },
            source: "harness:1:key",
          }}
          captureConversation={capture}
        />
      </StrictMode>,
    ),
  );
  return {
    scope,
    capture,
    captureMemorySession,
    views,
    view,
    input,
    manager,
    owner,
  };
}
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  scopes = [];
  captures = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let id = 0;
  invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "project_memory_open") return { id: ++id, token: "panel" };
    if (command === "project_memory_select") return `selection:${args.path}`;
    if (command === "project_memory_discover")
      return {
        schema: 1,
        root: "/project",
        blockedCount: 0,
        scope: { state: "ready", ancestryComplete: true },
      };
    if (command === "project_memory_review_trust")
      return trustReply(args.request.revision);
    if (command === "project_memory_context_open")
      return { id: ++id, token: "00000000-0000-4000-8000-000000000009" };
    if (command === "project_memory_context_bind")
      return { schema: 1, root: trustReply().root };
    if (command === "project_memory_context_read") {
      const value = packet();
      if (value.packet)
        value.packet.bytes = new TextEncoder().encode(value.packet.text).length;
      return value;
    }
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const capture of captures) capture.release();
  await Promise.all(scopes.map((scope) => scope.close()));
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("captures by gesture, reviews the execution cwd and prepares escaped context without agent delivery or trust writes", async () => {
  const f = await mount();
  expect(f.capture).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  await open();
  expect(f.capture).toHaveBeenCalledTimes(1);
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_open",
    ),
  ).toBe(false);
  await review();
  expect(
    invoke.mock.calls
      .filter(([command]) => command === "project_memory_select")
      .map(([, args]) => args.path),
  ).toContain("/project/worktree");
  expect(document.body.textContent).toContain("<script>untrusted()</script>");
  expect(document.querySelector("script")).toBeNull();
  await click("projectMemory.conversationPrepare");
  expect(document.body.textContent).toContain(
    "projectMemory.conversationPrepared",
  );
  expect(document.body.textContent).toContain(
    "projectMemory.conversationInitial",
  );
  expect(document.body.textContent).toContain("<script>context</script> ñ");
  expect(document.querySelector("script")).toBeNull();
  expect(
    invoke.mock.calls
      .map(([command]) => command)
      .every((command) => command.startsWith("project_memory_")),
  ).toBe(true);
  expect(
    invoke.mock.calls.some(
      ([command]) =>
        command.includes("confirm_trust") || command.includes("confirm_policy"),
    ),
  ).toBe(false);
  await click("common.close");
  expect(f.scope.status()).toBe("ready");
  expect(await f.scope.read()).not.toBeNull();
});

function requireAncestorInspection() {
  const original = invoke.getMockImplementation();
  const inspected = new Set<number>();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_select") {
      if (args.inspectAncestors === true) inspected.add(args.handle.id);
      else inspected.delete(args.handle.id);
    }
    if (command === "project_memory_discover" && !inspected.has(args.handle.id))
      return Promise.resolve({
        schema: 1,
        root: "/project",
        blockedCount: 1,
        scope: { state: "incomplete", ancestryComplete: false },
      });
    if (
      command === "project_memory_review_trust" &&
      !inspected.has(args.handle.id)
    )
      return Promise.reject({ code: "unavailable" });
    return original?.(command, args);
  });
}

it("requires the conversation's own ancestor inspection before reading instructions", async () => {
  requireAncestorInspection();
  await mount();
  await open();
  expect(invoke).toHaveBeenCalledWith(
    "project_memory_select",
    expect.objectContaining({
      path: "/project/browsed",
      inspectAncestors: true,
    }),
  );
  await click("projectMemory.conversationReview");
  const section = document.querySelector("section");
  expect(section?.textContent).toContain("projectMemory.inspectDescription");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_review_trust",
    ),
  ).toBe(false);
  await click("projectMemory.inspectAncestors");
  expect(button("projectMemory.conversationPrepare").disabled).toBe(true);
  const selected = invoke.mock.calls.filter(
    ([command]) => command === "project_memory_select",
  );
  expect(selected[selected.length - 1][1]).toMatchObject({
    path: "/project/worktree",
    inspectAncestors: true,
  });
  expect(
    invoke.mock.calls.some(
      ([command]) =>
        command.includes("confirm_trust") || command.includes("context_bind"),
    ),
  ).toBe(false);
});

it("does not read instructions after a consented inspection remains incomplete", async () => {
  requireAncestorInspection();
  await mount();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_discover"
      ? Promise.resolve({
          schema: 1,
          root: "/project",
          blockedCount: 1,
          scope: { state: "incomplete", ancestryComplete: false },
        })
      : original?.(command, args),
  );
  await open();
  await click("projectMemory.conversationReview");
  const inspect = document.querySelector<HTMLButtonElement>("section button");
  expect(inspect?.textContent).toBe("projectMemory.inspectAncestors");
  await act(async () => inspect?.click());
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_review_trust",
    ),
  ).toBe(false);
  expect(document.querySelector("section")?.textContent).toContain(
    "projectMemory.inspectDescription",
  );
});

it("suppresses an inspection result after the captured conversation loses focus", async () => {
  requireAncestorInspection();
  const f = await mount();
  await open();
  await click("projectMemory.conversationReview");
  const pending = deferred<unknown>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_discover"
      ? pending.promise
      : original?.(command, args),
  );
  const inspect = document.querySelector<HTMLButtonElement>("section button");
  expect(inspect?.textContent).toBe("projectMemory.inspectAncestors");
  await act(async () => inspect?.click());
  await act(async () =>
    f.view.update({
      ...f.input,
      report: { ...f.input.report, activeSessionId: null },
    }),
  );
  await act(async () =>
    pending.resolve({
      schema: 1,
      root: "/project",
      blockedCount: 0,
      scope: { state: "ready", ancestryComplete: true },
    }),
  );
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_review_trust",
    ),
  ).toBe(false);
  expect(document.body.textContent).toContain(
    "projectMemory.conversationRetired",
  );
});

it("manages the selected worktree's files without trust settings and returns to the browsed directory", async () => {
  await mount();
  await open();
  const paths = () =>
    invoke.mock.calls
      .filter(([command]) => command === "project_memory_select")
      .map(([, args]) => args.path);
  expect(paths()).not.toContain("/project/worktree");
  await click("projectMemory.manageConversationDirectory");
  expect(paths()[paths().length - 1]).toBe("/project/worktree");
  expect(document.body.textContent).not.toContain("projectMemory.reviewTrust");
  expect(document.body.textContent).not.toContain("projectMemory.policyConfigure");
  await click("projectMemory.manageBrowsedDirectory");
  expect(paths()[paths().length - 1]).toBe("/project/browsed");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_open",
    ),
  ).toBe(false);
});

it.each(["KIT_MEMORY_POLICY_NEVER", "KIT_MEMORY_TRUST_REQUIRED"])(
  "shows blocked native context without claiming preparation: %s",
  async (reason) => {
    await mount();
    await open();
    await review();
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) =>
      command === "project_memory_context_read"
        ? Promise.resolve(packet(reason))
        : original?.(command, args),
    );
    await click("projectMemory.conversationPrepare");
    expect(document.body.textContent).not.toContain(
      "projectMemory.conversationPrepared",
    );
    expect(document.body.textContent).toContain(
      reason === "KIT_MEMORY_POLICY_NEVER"
        ? "projectMemory.conversationPolicyBlocked"
        : "projectMemory.conversationTrustBlocked",
    );
  },
);

it("retires pending admission when the panel closes without binding its successor", async () => {
  const f = await mount();
  await open();
  await review();
  const opening = deferred<unknown>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_context_open"
      ? opening.promise
      : original?.(command, args),
  );
  await click("projectMemory.conversationPrepare");
  await click("common.close");
  await act(async () =>
    opening.resolve({ id: 99, token: "00000000-0000-4000-8000-000000000099" }),
  );
  expect(f.scope.status()).toBe("retired");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_bind",
    ),
  ).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_context_close", {
    handle: { id: 99, token: "00000000-0000-4000-8000-000000000099" },
  });
});

it("withdraws captured conversation on focus loss without closing accepted engine memory", async () => {
  const f = await mount();
  await open();
  await review();
  await click("projectMemory.conversationPrepare");
  await act(async () =>
    f.view.update({
      ...f.input,
      report: { ...f.input.report, activeSessionId: null },
    }),
  );
  expect(document.body.textContent).toContain(
    "projectMemory.conversationRetired",
  );
  expect(document.body.textContent).not.toContain("<script>context</script>");
  expect(f.scope.status()).toBe("ready");
  await act(async () => f.view.update(f.input));
  expect(document.body.textContent).toContain(
    "projectMemory.conversationRetired",
  );
  await expect(captures[0].conversation.read()).rejects.toMatchObject({
    code: "cancelled",
  });
  expect(await f.scope.read()).not.toBeNull();
});

it("disables only the exact bound context after an explicit action", async () => {
  const f = await mount();
  await open();
  await review();
  await click("projectMemory.conversationPrepare");
  await click("projectMemory.conversationDisable");
  expect(f.scope.status()).toBe("retired");
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_context_close",
    ),
  ).toHaveLength(1);
});

it("releases exact focus and subscriptions when a caller subscription fails", async () => {
  const f = await mount();
  for (let index = 0; index < 257; index++) {
    expect(() =>
      captureHarnessMemoryConversation(
        { captureMemorySession: () => f.scope },
        f.views,
        1,
        "/project",
        {
          isCurrent: () => true,
          subscribe: () => {
            throw new Error("source subscription");
          },
        },
      ),
    ).toThrow("source subscription");
  }
  expect(invoke).not.toHaveBeenCalled();
  await open();
  expect(f.capture).toHaveBeenCalledTimes(1);
});

it("latches source retirement, releases observers and preserves the engine receipt", async () => {
  const f = await mount();
  let active = true;
  let changed: () => void = () => undefined;
  const unsubscribe = vi.fn();
  const capture = captureHarnessMemoryConversation(
    { captureMemorySession: () => f.scope },
    f.views,
    1,
    "/project",
    {
      isCurrent: () => active,
      subscribe(listener) {
        changed = listener;
        return unsubscribe;
      },
    },
  );
  if (!capture) throw new Error("Missing capture");
  captures.push(capture);
  const observer = vi.fn();
  capture.conversation.subscribe(observer);
  active = false;
  changed();
  active = true;
  changed();
  expect(capture.conversation.status()).toBe("retired");
  expect(observer).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(f.scope.status()).toBe("inactive");
});

it("retains disposed panel capacity through pending native selection settlement", async () => {
  const f = await mount();
  const selection = deferred<unknown>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_select"
      ? selection.promise
      : original?.(command, args),
  );
  const panels = Array.from({ length: 256 }, () =>
    createMemoryConversationPanel(f.scope, { kind: "local" }, () => undefined),
  );
  const work = panels.map((panel) => panel.review());
  await act(async () => undefined);
  await Promise.all(panels.map((panel) => panel.dispose()));
  expect(() =>
    createMemoryConversationPanel(f.scope, { kind: "local" }, () => undefined),
  ).toThrow("busy");
  selection.resolve("selection");
  await Promise.all(work);
  const next = createMemoryConversationPanel(
    f.scope,
    { kind: "local" },
    () => undefined,
  );
  await next.dispose();
});

it("retains failed presentation cleanup for exact retry before freeing panel capacity", async () => {
  const f = await mount();
  const panels = Array.from({ length: 256 }, () =>
    createMemoryConversationPanel(f.scope, { kind: "local" }, () => undefined),
  );
  await Promise.all(panels.map((panel) => panel.review()));
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_close"
      ? Promise.reject({ code: "unavailable" })
      : original?.(command, args),
  );
  expect(
    (await Promise.all(panels.map((panel) => panel.dispose()))).every(
      (closed) => !closed,
    ),
  ).toBe(true);
  expect(() =>
    createMemoryConversationPanel(f.scope, { kind: "local" }, () => undefined),
  ).toThrow("busy");
  await Promise.all(panels.map((panel) => panel.dispose()));
  if (!original) throw new Error("Missing native fixture implementation");
  invoke.mockImplementation(original);
  expect(
    (await Promise.all(panels.map((panel) => panel.dispose()))).every(Boolean),
  ).toBe(true);
  const next = createMemoryConversationPanel(
    f.scope,
    { kind: "local" },
    () => undefined,
  );
  await next.dispose();
  expect(f.scope.status()).toBe("inactive");
});

it("rejects a closed panel's late packet while preserving memory for a fresh panel", async () => {
  const f = await mount();
  await open();
  await review();
  await click("projectMemory.conversationPrepare");
  const read = deferred<unknown>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_context_read"
      ? read.promise
      : original?.(command, args),
  );
  await click("projectMemory.conversationRead");
  await click("common.close");
  await act(async () => read.resolve(packet("KIT_MEMORY_POLICY_NEVER")));
  expect(f.scope.status()).toBe("ready");
  if (!original) throw new Error("Missing native fixture implementation");
  invoke.mockImplementation(original);
  await open();
  expect(document.body.textContent).not.toContain(
    "projectMemory.conversationPolicyBlocked",
  );
  expect(document.body.textContent).not.toContain(
    "projectMemory.conversationPrepared",
  );
  await click("projectMemory.conversationRead");
  expect(document.body.textContent).toContain(
    "projectMemory.conversationPrepared",
  );
});

async function prepare(supportsDelivery = false) {
  const f = await mount(supportsDelivery);
  await open();
  await review();
  await click("projectMemory.conversationPrepare");
  return f;
}

it("copies the exact preview after a fresh native read without claiming agent delivery", async () => {
  await prepare();
  const reads = () =>
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_context_read",
    ).length;
  const before = reads();
  expect(writeText).not.toHaveBeenCalled();
  await click("common.copy");
  expect(reads()).toBe(before + 1);
  expect(writeText).toHaveBeenCalledExactlyOnceWith(packet().packet?.text);
  expect(document.body.textContent).toContain("common.copied");
  expect(document.body.textContent).toContain(
    "projectMemory.conversationPrepared",
  );
});

it.each(["KIT_MEMORY_POLICY_NEVER", "KIT_MEMORY_INSTRUCTIONS_CHANGED"])(
  "rechecks %s before copying and withdraws the old preview",
  async (reason) => {
    await prepare();
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) =>
      command === "project_memory_context_read"
        ? Promise.resolve(packet(reason))
        : original?.(command, args),
    );
    await click("common.copy");
    expect(writeText).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("<script>context</script>");
    expect(document.body.textContent).not.toContain("common.copied");
    const conversation = document.querySelector("section");
    expect(conversation).not.toBeNull();
    expect(
      [...(conversation?.querySelectorAll("button") ?? [])].some(
        (item) => item.textContent === "common.copy",
      ),
    ).toBe(false);
  },
);

it("requires a new gesture after factual content changes instead of copying unseen text", async () => {
  await prepare();
  const original = invoke.getMockImplementation();
  const changed = packet();
  if (!changed.packet) throw new Error("Missing packet");
  changed.packet.text = "Fresh project facts";
  changed.packet.bytes = new TextEncoder().encode(changed.packet.text).length;
  changed.packet.digest = "d".repeat(64);
  invoke.mockImplementation((command, args) =>
    command === "project_memory_context_read"
      ? Promise.resolve(changed)
      : original?.(command, args),
  );
  await click("common.copy");
  expect(writeText).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(changed.packet.text);
  await click("common.copy");
  expect(writeText).toHaveBeenCalledExactlyOnceWith(changed.packet.text);
});

it.each(["close", "focus"])(
  "rejects late copy reads after %s without closing accepted engine memory",
  async (kind) => {
    const f = await prepare();
    const read = deferred<unknown>();
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) =>
      command === "project_memory_context_read"
        ? read.promise
        : original?.(command, args),
    );
    await click("common.copy");
    if (kind === "close") await click("common.close");
    else
      await act(async () =>
        f.view.update({
          ...f.input,
          report: { ...f.input.report, activeSessionId: null },
        }),
      );
    await act(async () => read.resolve(packet()));
    expect(writeText).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("common.copied");
    expect(f.scope.status()).toBe("ready");
  },
);

it("reports clipboard failure without false success and permits an explicit retry", async () => {
  await prepare();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("Web clipboard unavailable"),
  );
  writeText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  await click("common.copy");
  expect(document.body.textContent).toContain("harness.chrome.copyFailed");
  expect(document.body.textContent).not.toContain("common.copied");
  await click("common.copy");
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain("common.copied");
  expect(document.body.textContent).not.toContain("harness.chrome.copyFailed");
});

it("uses the existing web clipboard fallback when native clipboard is unavailable", async () => {
  await prepare();
  const web = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  writeText.mockRejectedValueOnce(new Error("Native clipboard unavailable"));
  await click("common.copy");
  expect(web).toHaveBeenCalledExactlyOnceWith(packet().packet?.text);
  expect(document.body.textContent).toContain("common.copied");
});

it("does not enter clipboard fallbacks after the original focus retires", async () => {
  const f = await prepare();
  const web = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const write = deferred<void>();
  writeText.mockImplementationOnce(async () => {
    await write.promise;
    throw new Error("Native clipboard unavailable");
  });
  await click("common.copy");
  await act(async () =>
    f.view.update({
      ...f.input,
      report: { ...f.input.report, activeSessionId: null },
    }),
  );
  await act(async () => write.resolve());
  expect(web).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("common.copied");
});

it("coalesces copy gestures and suppresses late clipboard feedback after panel closure", async () => {
  const f = await prepare();
  const write = deferred<void>();
  writeText.mockReturnValue(write.promise);
  await click("common.copy");
  expect(button("common.copy").disabled).toBe(true);
  await click("common.copy");
  expect(writeText).toHaveBeenCalledTimes(1);
  await click("common.close");
  await act(async () => write.resolve());
  await open();
  expect(document.body.textContent).not.toContain("common.copied");
  expect(f.scope.status()).toBe("ready");
});

it("requires explicit delivery consent after preparation and preserves it after panel closure", async () => {
  const f = await prepare(true);
  expect(f.manager.turnSource(f.owner, () => {})).toBeUndefined();
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(false);
  await click("projectMemory.deliveryEnable");
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(true);
  expect(document.body.textContent).toContain("projectMemory.deliveryEnabled");
  expect(f.scope.delivery?.getSnapshot().receipt).toBeNull();
  expect(
    invoke.mock.calls.every(([command]) =>
      command.startsWith("project_memory_"),
    ),
  ).toBe(true);
  await click("common.close");
  expect(f.manager.turnSource(f.owner, () => {})).toBeDefined();
});

it("updates the open panel only after provider acceptance and keeps the delivered text separate", async () => {
  const f = await prepare(true);
  await click("projectMemory.deliveryEnable");
  const source = f.manager.turnSource(f.owner, () => {});
  if (!source) throw new Error("Missing delivery source");
  const prepared = await source.prepare({}, "provider-thread", () => {});
  expect(document.body.textContent).not.toContain(
    "projectMemory.deliveryLastAccepted",
  );
  await act(async () => {
    expect(prepared?.acknowledge()).toBe(true);
  });
  expect(document.body.textContent).toContain(
    "projectMemory.deliveryLastAccepted",
  );
  expect(document.body.textContent).toContain("projectMemory.deliveryAccepted");
  expect(document.body.textContent).toContain("provider-thread");
  expect(document.body.textContent).not.toContain(
    "projectMemory.conversationPrepared",
  );
  expect(document.querySelector("script")).toBeNull();
});

it("retains the manual copy alternative for an adapter without automatic delivery", async () => {
  await prepare();
  expect(document.body.textContent).toContain(
    "projectMemory.deliveryUnsupported",
  );
  expect(button("common.copy").disabled).toBe(false);
  expect(
    [...document.querySelectorAll("button")].some(
      (item) => item.textContent === "projectMemory.deliveryEnable",
    ),
  ).toBe(false);
});

it("does not enable a retired caller after a late native read", async () => {
  const f = await prepare(true);
  const read = deferred<unknown>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_context_read"
      ? read.promise
      : original?.(command, args),
  );
  await click("projectMemory.deliveryEnable");
  await act(async () =>
    f.view.update({
      ...f.input,
      report: { ...f.input.report, activeSessionId: null },
    }),
  );
  await act(async () => read.resolve(packet()));
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(false);
  expect(f.manager.turnSource(f.owner, () => {})).toBeUndefined();
  expect(f.scope.status()).toBe("ready");
});

it("requires a new gesture to enable a packet changed since its preview", async () => {
  const f = await prepare(true);
  const original = invoke.getMockImplementation();
  const changed = packet();
  if (!changed.packet) throw new Error("Missing packet");
  changed.packet.text = "new facts";
  changed.packet.bytes = new TextEncoder().encode(changed.packet.text).length;
  changed.packet.digest = "d".repeat(64);
  invoke.mockImplementation((command, args) =>
    command === "project_memory_context_read"
      ? Promise.resolve(changed)
      : original?.(command, args),
  );
  await click("projectMemory.deliveryEnable");
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(false);
  expect(document.body.textContent).toContain("new facts");
  await click("projectMemory.deliveryEnable");
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(true);
});

it("can disable and re-enable future delivery in the same panel while preserving the accepted receipt", async () => {
  const f = await prepare(true);
  await click("projectMemory.deliveryEnable");
  const source = f.manager.turnSource(f.owner, () => {});
  if (!source) throw new Error("Missing delivery source");
  const prepared = await source.prepare({}, "provider-thread", () => {});
  await act(async () => expect(prepared?.acknowledge()).toBe(true));
  const receipt = f.scope.delivery?.getSnapshot().receipt;
  const writes = invoke.mock.calls.length;
  await click("projectMemory.conversationDisable");
  expect(invoke.mock.calls).toHaveLength(writes);
  expect(f.scope.status()).toBe("ready");
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(false);
  expect(f.scope.delivery?.getSnapshot().receipt).toBe(receipt);
  expect(document.body.textContent).not.toContain(
    "projectMemory.conversationRetired",
  );
  expect(document.body.textContent).not.toContain(
    "projectMemory.deliveryEnabled",
  );
  expect(button("common.copy").disabled).toBe(false);
  await click("projectMemory.deliveryEnable");
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(true);
  expect(() => source.assertCurrent()).toThrowError("cancelled");
  await click("common.close");
  await open();
  expect(document.body.textContent).toContain("projectMemory.deliveryEnabled");
});

it("does not acknowledge an old prepared turn after disabling and re-enabling delivery", async () => {
  const f = await prepare(true);
  await click("projectMemory.deliveryEnable");
  const source = f.manager.turnSource(f.owner, () => {});
  if (!source) throw new Error("Missing delivery source");
  const prepared = await source.prepare({}, "old-thread", () => {});
  await click("projectMemory.conversationDisable");
  await click("projectMemory.deliveryEnable");
  expect(prepared?.acknowledge()).toBe(false);
  expect(f.scope.delivery?.getSnapshot().receipt).toBeNull();
  expect(document.body.textContent).not.toContain(
    "projectMemory.deliveryLastAccepted",
  );
  const fresh = f.manager.turnSource(f.owner, () => {});
  if (!fresh) throw new Error("Missing fresh delivery source");
  const next = await fresh.prepare({}, "new-thread", () => {});
  await act(async () => expect(next?.acknowledge()).toBe(true));
  expect(document.body.textContent).toContain("new-thread");
});

it("keeps delivery disabled when project policy changes before re-enabling", async () => {
  const f = await prepare(true);
  await click("projectMemory.deliveryEnable");
  await click("projectMemory.conversationDisable");
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_context_read"
      ? Promise.resolve(packet("KIT_MEMORY_POLICY_NEVER"))
      : original?.(command, args),
  );
  await click("projectMemory.deliveryEnable");
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(false);
  expect(f.manager.turnSource(f.owner, () => {})).toBeUndefined();
  expect(document.body.textContent).toContain(
    "projectMemory.conversationPolicyBlocked",
  );
  expect(document.body.textContent).not.toContain("<script>context</script>");
});
