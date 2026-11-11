// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { FeedResponse } from "../lib/types";

const poll = vi.hoisted(() => ({
  calls: 0,
  requests: [] as unknown[],
  response: null as FeedResponse | null,
}));

vi.mock("../lib/feedSource", async (importActual) => {
  const actual = await importActual<typeof import("../lib/feedSource")>();
  return {
    ...actual,
    pollFeed: vi.fn(async (_target: unknown, request: unknown) => {
      poll.calls += 1;
      poll.requests.push(request);
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
  poll.requests = [];
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

it("lists every agent on the machine when the window has no project", async () => {
  poll.response = FEED;
  await render(null);
  expect(poll.requests[0]).toMatchObject({ scope: "host", root: "" });
  expect(document.body.textContent).toContain("All agents on this computer");
  const project = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "This project",
  );
  expect(project?.disabled).toBe(true);
});

it("reads one project when asked", async () => {
  poll.response = FEED;
  await render("/srv/webserver");
  const project = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "This project",
  );
  await act(async () => project?.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(poll.requests[poll.requests.length - 1]).toMatchObject({ scope: "project", root: "/srv/webserver" });
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

it("floats over the app and moves by its header", async () => {
  poll.response = FEED;
  await render("/srv/webserver");
  // Not modal: no overlay blocks the terminal behind it.
  expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
  const header = document.querySelector<HTMLElement>('[data-slot="dialog-header"]');
  const panel = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
  expect(header && panel).toBeTruthy();
  const fire = (type: string, x: number, y: number) =>
    header?.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  await act(async () => {
    fire("pointerdown", 100, 100);
    fire("pointermove", 160, 130);
    fire("pointerup", 160, 130);
  });
  expect(panel?.style.left).toBe("calc(50% + 60px)");
  expect(panel?.style.top).toBe("calc(50% + 30px)");
  expect(JSON.parse(localStorage.getItem("voktty.agentFeed.position") ?? "null")).toEqual({ x: 60, y: 30 });
  await act(async () => {
    header?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  expect(panel?.style.left).toBe("calc(50% + 0px)");
});

it("tags the question an agent waits on and marks it seen", async () => {
  const { useAgentAttention, unseenAttention } = await import("../lib/attentionStore");
  useAgentAttention.setState({
    bySource: {
      local: [
        { key: "local:orch", sourceKey: "local", recordId: "n1", agent: "orquestador", host: "", text: "?", ts: "" },
      ],
    },
    origins: {},
    seen: {},
  });
  poll.response = FEED;
  await render("/srv/webserver");
  expect(document.body.textContent).toContain("Needs you");
  expect(unseenAttention(useAgentAttention.getState())).toHaveLength(0);
});
