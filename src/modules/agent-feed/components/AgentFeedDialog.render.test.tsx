// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { FeedResponse } from "../lib/types";

const poll = vi.hoisted(() => ({ calls: 0, response: null as FeedResponse | null }));

vi.mock("../lib/feedSource", async (importActual) => {
  const actual = await importActual<typeof import("../lib/feedSource")>();
  return {
    ...actual,
    pollFeed: vi.fn(async () => {
      poll.calls += 1;
      if (!poll.response) throw new Error("no response");
      return poll.response;
    }),
  };
});

import AgentFeedDialog from "./AgentFeedDialog";

const FEED: FeedResponse = {
  available: true,
  sessions: [
    {
      pid: 100,
      sessionId: "orch",
      name: "orquestador",
      cwd: "/srv/webserver",
      status: "busy",
      tmux: "forgenex:@1.%1",
      version: "2.1.322",
      updatedAt: 1,
      alive: true,
    },
  ],
  transcripts: [],
  records: [
    {
      id: "s1",
      kind: "send",
      ts: "2026-11-11T11:51:10.000Z",
      sessionId: "orch",
      peer: "nodo",
      peerPid: null,
      summary: "Encargo CRM 279",
      text: "Prueba la 279. token sk-ant-abcdefghijklmnopqrstuvwxyz0123",
      truncated: false,
    },
    {
      id: "n1",
      kind: "note",
      ts: "2026-11-11T11:52:00.000Z",
      sessionId: "orch",
      peer: "",
      peerPid: null,
      summary: null,
      text: "Se la he pasado a nodo.",
      truncated: false,
    },
  ],
  cursor: { files: {} },
  truncated: false,
  unrecognized: 0,
};

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  poll.calls = 0;
  poll.response = null;
});

async function render(root: string | null) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const reactRoot = createRoot(host);
  await act(async () => {
    reactRoot.render(
      createElement(AgentFeedDialog, {
        open: true,
        onOpenChange: () => {},
        root,
        env: { kind: "local" },
      }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup = () => {
    act(() => reactRoot.unmount());
    host.remove();
  };
}

it("asks for a project when the window has none", async () => {
  await render(null);
  expect(document.body.textContent).toContain("Open a project folder");
  expect(poll.calls).toBe(0);
});

it("shows the agents, their messages and notes, with secrets redacted", async () => {
  poll.response = FEED;
  await render("/srv/webserver");
  const text = document.body.textContent ?? "";
  expect(text).toContain("orquestador");
  expect(text).toContain("Orchestrator");
  expect(text).toContain("Encargo CRM 279");
  expect(text).toContain("Se la he pasado a nodo.");
  expect(text).toContain("<REDACTED:");
  expect(text).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz0123");
  expect(text).toContain("Copy tmux");
});

it("reports an empty range", async () => {
  poll.response = { ...FEED, sessions: [], records: [] };
  await render("/srv/webserver");
  expect(document.body.textContent).toContain("No messages in this range");
});
