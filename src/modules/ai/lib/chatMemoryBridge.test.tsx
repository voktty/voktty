// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  captureChatMemoryConversation,
  forgetChatMemoryOwner,
} from "@/modules/ai/lib/chatMemoryOwner";
import { useAiLiveBridge } from "@/modules/ai/lib/useAiLiveBridge";
import { getOrCreateChat } from "@/modules/ai/store/chatRuntime";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import type { Tab } from "@/modules/tabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));
vi.mock("@/modules/ai/lib/transport", () => ({
  createContextAwareTransport: () => ({
    sendMessages: vi.fn(),
    reconnectToStream: async () => null,
  }),
}));

let root: Root;
let scopes: MemoryConversation[];
const terminalRefs = { current: new Map() };
const editorRefs = { current: new Map() };
const tabs: Tab[] = [];
const openPreviewTab = () => undefined;
const newAgentTab = () => ({ tabId: 1, leafId: 1 });
function Host({
  path,
  workspace,
}: {
  path: string | null;
  workspace: WorkspaceEnv;
}) {
  useAiLiveBridge({
    setLive: useChatStore.getState().setLive,
    activeId: 1,
    tabs,
    explorerRoot: path,
    explorerWorkspace: workspace,
    launchCwd: null,
    home: null,
    terminalRefs,
    editorRefs,
    openPreviewTab,
    newAgentTab,
  });
  return null;
}
function render(
  path: string | null,
  workspace: WorkspaceEnv = { kind: "local" },
) {
  act(() => root.render(createElement(Host, { path, workspace })));
}
function capture() {
  const chat = getOrCreateChat("fixture");
  const scope = captureChatMemoryConversation(chat);
  if (!scope) throw new Error("Missing bridge memory capture");
  scopes.push(scope);
  return scope;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockReset();
  scopes = [];
  chats.clear();
  root = createRoot(document.createElement("div"));
  render("/project");
});
afterEach(async () => {
  act(() => root.unmount());
  for (const chat of chats.values()) forgetChatMemoryOwner(chat);
  await Promise.all(scopes.map((scope) => scope.close()));
  chats.clear();
  vi.unstubAllGlobals();
});

it.each(["/other", null])(
  "observes a root roundtrip through %j without republishing Live",
  (path) => {
    const live = useChatStore.getState().live;
    const scope = capture();
    render(path);
    expect(useChatStore.getState().live).toBe(live);
    render("/project");
    expect(scope.isCurrent()).toBe(false);
    expect(
      captureChatMemoryConversation(getOrCreateChat("fixture")),
    ).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  },
);

it("observes a same-path filesystem roundtrip without local fallback", () => {
  const scope = capture();
  render("/project", { kind: "wsl", distro: "fixture" });
  render("/project");
  expect(scope.isCurrent()).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});

it("preserves the owner during harmless layout publications at the same root", () => {
  const scope = capture();
  render("/project");
  render("/project");
  expect(capture()).toBe(scope);
  expect(scope.isCurrent()).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
});

it("retires captured memory when the original bridge unmounts", () => {
  const scope = capture();
  act(() => root.unmount());
  root = createRoot(document.createElement("div"));
  render("/project");
  expect(scope.isCurrent()).toBe(false);
  expect(captureChatMemoryConversation(getOrCreateChat("fixture"))).toBeNull();
});

it("bounds exact observers, isolates failures and removes observers during publication", () => {
  const subscribe = useChatStore.getState().live.subscribeFileRootContext;
  if (!subscribe) throw new Error("Missing root subscription");
  const removed = vi.fn();
  let remove: () => void = () => undefined;
  const first = subscribe(() => {
    remove();
    throw new Error("observer");
  });
  remove = subscribe(removed);
  const listeners = Array.from({ length: 254 }, () => () => undefined);
  const releases = listeners.map(subscribe);
  expect(() => subscribe(() => undefined)).toThrow("capacity");
  render("/other");
  expect(removed).not.toHaveBeenCalled();
  const next = subscribe(() => undefined);
  first();
  next();
  for (const release of releases) release();
  expect(invoke).not.toHaveBeenCalled();
});
