// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FeedResponse } from "../lib/types";

const io = vi.hoisted(() => ({
  responses: [] as FeedResponse[],
  polls: [] as { options: unknown }[],
  notify: vi.fn(),
}));

vi.mock("../lib/feedSource", () => ({
  pollFeed: vi.fn(async (_target: unknown, _request: unknown, options: unknown) => {
    io.polls.push({ options });
    const next = io.responses.shift();
    if (!next) throw new Error("offline");
    return next;
  }),
}));
vi.mock("@/modules/agents/lib/route", () => ({ routeAgentNotification: io.notify }));
// The real module binds a Tauri event listener on import.
vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  getLeafWorkspaceEnv: () => undefined,
}));

import { useAgentAttention } from "../lib/attentionStore";
import AgentFeedWatcher, { WATCH_INTERVAL_MS } from "./AgentFeedWatcher";

function feed(recordId: string, text: string, status = "idle"): FeedResponse {
  return {
    available: true,
    sessions: [
      {
        pid: 1,
        sessionId: "o",
        name: "orquestador",
        cwd: "/srv",
        status,
        tmux: null,
        version: null,
        updatedAt: null,
        alive: true,
      },
    ],
    transcripts: [],
    records: [
      { id: recordId, kind: "note", ts: `2026-11-11T15:0${recordId.length}:00Z`, sessionId: "o", peer: "", peerPid: null, summary: null, text, truncated: false },
    ],
    cursor: { files: {} },
    truncated: false,
    unrecognized: 0,
  };
}

// An SSH terminal tab on the miniserver, kept in the background.
const MINI_TAB = {
  id: 3,
  kind: "terminal",
  title: "miniserver",
  paneTree: { kind: "leaf", id: 30 },
  activeLeafId: 30,
  workspaceEnv: {
    kind: "ssh",
    connection: { id: "mini", name: "miniserver", host: "mini.lan" },
    root: "/",
    sessionId: 7,
  },
} as never;

let root: Root;
let host: HTMLDivElement;
let tabs: never[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  io.responses = [];
  io.polls = [];
  io.notify.mockReset();
  tabs = [MINI_TAB];
  useAgentAttention.setState({ bySource: {}, agents: {}, origins: {}, seen: {}, viewing: null, requestedView: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(onOpen = vi.fn()) {
  await act(async () =>
    root.render(createElement(AgentFeedWatcher, { getTabs: () => tabs, onOpen })),
  );
  await advance(0);
  return onOpen;
}

it("badges what already waited at launch and notifies only new questions", async () => {
  io.responses = [feed("old", "Espero tu OK."), feed("new1", "¿Lo despliego?")];
  const onOpen = await mount();
  expect(useAgentAttention.getState().bySource["ssh:mini"]).toEqual([
    expect.objectContaining({ recordId: "old", agent: "orquestador" }),
  ]);
  expect(io.notify).not.toHaveBeenCalled();

  await advance(WATCH_INTERVAL_MS);
  expect(io.notify).toHaveBeenCalledOnce();
  const call = io.notify.mock.calls[0][0];
  expect(call).toMatchObject({
    agent: "orquestador",
    kind: "attention",
    title: "orquestador on miniserver is waiting for you",
    body: "¿Lo despliego?",
    tabId: 3,
    leafId: 30,
  });
  call.onActivate();
  expect(onOpen).toHaveBeenCalledWith(
    expect.objectContaining({ key: "ssh:mini", tabId: 3, leafId: 30 }),
    expect.objectContaining({ recordId: "new1", cwd: "/srv" }),
  );
  // Never reopens a dropped connection on its own.
  expect(io.polls.every((poll) => (poll.options as { recover: boolean }).recover === false)).toBe(true);
});

it("keeps watching after a failed round and forgets hosts whose tabs closed", async () => {
  io.responses = [feed("old", "Espero tu OK.")];
  await mount();
  expect(useAgentAttention.getState().bySource["ssh:mini"]).toHaveLength(1);
  await advance(WATCH_INTERVAL_MS);
  expect(io.polls).toHaveLength(2);
  tabs = [];
  await advance(WATCH_INTERVAL_MS);
  expect(useAgentAttention.getState().bySource["ssh:mini"]).toBeUndefined();
  expect(io.polls).toHaveLength(2);
});
