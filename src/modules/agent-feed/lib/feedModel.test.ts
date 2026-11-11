import { describe, expect, it } from "vitest";
import { buildTimeline, emptyFeed, mergeFeed } from "./feedModel";
import type { FeedRecord, FeedResponse, LiveSession } from "./types";

function record(partial: Partial<FeedRecord> & Pick<FeedRecord, "id" | "kind" | "ts" | "sessionId">): FeedRecord {
  return { peer: "", peerPid: null, summary: null, text: "", truncated: false, ...partial };
}

function live(partial: Partial<LiveSession> & Pick<LiveSession, "pid" | "sessionId">): LiveSession {
  return {
    name: null,
    cwd: null,
    status: "idle",
    tmux: null,
    version: null,
    updatedAt: null,
    alive: true,
    ...partial,
  };
}

function response(partial: Partial<FeedResponse>): FeedResponse {
  return {
    available: true,
    sessions: [],
    transcripts: [],
    records: [],
    cursor: { files: {} },
    truncated: false,
    unrecognized: 0,
    ...partial,
  };
}

// orquestador (live, pid 100) -> panel-crm (exited) -> orquestador -> nodo (by socket, pid 200)
const THREAD = response({
  sessions: [
    live({ pid: 100, sessionId: "orch", name: "orquestador", status: "busy", tmux: "forgenex:@1.%1" }),
    live({ pid: 200, sessionId: "nodo", name: "nodo", status: "shell" }),
  ],
  transcripts: [
    { sessionId: "orch", firstTs: "2026-11-11T11:00:00.000Z", lastTs: "2026-11-11T12:54:00.000Z" },
    { sessionId: "panel", firstTs: "2026-11-11T11:51:00.000Z", lastTs: "2026-11-11T12:53:21.000Z" },
  ],
  records: [
    record({ id: "h", kind: "human", ts: "2026-11-11T11:50:00.000Z", sessionId: "orch", text: "vale, sigue" }),
    record({ id: "s1", kind: "send", ts: "2026-11-11T11:51:10.000Z", sessionId: "orch", peer: "panel-crm", summary: "Encargo CRM 279", text: "Encargo  nuevo:\nCRM 279" }),
    record({ id: "r1", kind: "recv", ts: "2026-11-11T11:51:10.300Z", sessionId: "panel", peer: "orquestador", peerPid: 100, text: "Encargo nuevo: CRM 279" }),
    record({ id: "s2", kind: "send", ts: "2026-11-11T12:53:21.000Z", sessionId: "panel", peer: "uds:/run/user/0/cc-socks/100.sock", peerPid: 100, text: "279 lista" }),
    record({ id: "r2", kind: "recv", ts: "2026-11-11T12:53:21.400Z", sessionId: "orch", peer: "panel-crm", peerPid: 300, text: "279 lista" }),
    record({ id: "s3", kind: "send", ts: "2026-11-11T12:53:41.000Z", sessionId: "orch", peer: "uds:/run/user/0/cc-socks/200.sock", peerPid: 200, text: "Encargo: probar 279" }),
    record({ id: "n", kind: "note", ts: "2026-11-11T12:53:50.000Z", sessionId: "orch", text: "Se la he pasado a nodo." }),
  ],
});

describe("agent feed timeline", () => {
  it("pairs sends with receipts and names every end", () => {
    const { items } = buildTimeline(mergeFeed(emptyFeed(), THREAD));
    const messages = items.filter((item) => item.kind === "message");
    expect(messages.map((m) => m.kind === "message" && [m.from, m.to, m.delivered])).toEqual([
      ["orquestador", "panel-crm", true],
      ["panel-crm", "orquestador", true],
      ["orquestador", "nodo", false],
    ]);
    expect(items.map((item) => item.kind)).toEqual([
      "joined",
      "human",
      "joined",
      "message",
      "message",
      "left",
      "message",
      "note",
    ]);
  });

  it("marks who left, who works and who leads", () => {
    const { agents, items } = buildTimeline(mergeFeed(emptyFeed(), THREAD));
    expect(agents.map((a) => [a.name, a.status, a.orchestrator])).toEqual([
      ["orquestador", "busy", true],
      ["nodo", "shell", false],
      ["panel-crm", "gone", false],
    ]);
    expect(agents[0].tmux).toBe("forgenex:@1.%1");
    const left = items.find((item) => item.kind === "left");
    expect(left?.kind === "left" && left.agent).toBe("panel-crm");
  });

  it("infers the leader from who hands out work when nobody is called orchestrator", () => {
    const feed = response({
      sessions: [
        live({ pid: 1, sessionId: "a", name: "lead" }),
        live({ pid: 2, sessionId: "b", name: "web" }),
        live({ pid: 3, sessionId: "c", name: "api" }),
      ],
      records: [
        record({ id: "1", kind: "send", ts: "2026-11-11T10:00:00.000Z", sessionId: "a", peer: "web", text: "uno" }),
        record({ id: "2", kind: "send", ts: "2026-11-11T10:01:00.000Z", sessionId: "a", peer: "api", text: "dos" }),
        record({ id: "3", kind: "send", ts: "2026-11-11T10:02:00.000Z", sessionId: "b", peer: "lead", text: "tres" }),
      ],
    });
    const { agents } = buildTimeline(mergeFeed(emptyFeed(), feed));
    expect(agents.filter((a) => a.orchestrator).map((a) => a.name)).toEqual(["lead"]);
  });

  it("merges polls without duplicates and replaces the live snapshot", () => {
    let state = mergeFeed(emptyFeed(), THREAD);
    state = mergeFeed(state, response({ records: THREAD.records.slice(0, 2), sessions: [] }));
    expect(state.records.size).toBe(THREAD.records.length);
    // nodo and orquestador are no longer live: both now count as gone.
    const { agents } = buildTimeline(state);
    expect(agents.every((a) => a.status === "gone")).toBe(true);
  });

  it("does not pair a message with an old receipt of the same text", () => {
    const feed = response({
      records: [
        record({ id: "r", kind: "recv", ts: "2026-11-11T08:00:00.000Z", sessionId: "b", peer: "a", text: "ok" }),
        record({ id: "s", kind: "send", ts: "2026-11-11T12:00:00.000Z", sessionId: "a", peer: "b", text: "ok" }),
      ],
    });
    const messages = buildTimeline(mergeFeed(emptyFeed(), feed)).items.filter((i) => i.kind === "message");
    expect(messages).toHaveLength(2);
  });

  it("labels sessions without a known name by their id", () => {
    const feed = response({
      records: [record({ id: "n", kind: "note", ts: "2026-11-11T10:00:00.000Z", sessionId: "5bbd2340-aaaa", text: "hola" })],
    });
    const { items } = buildTimeline(mergeFeed(emptyFeed(), feed));
    expect(items[0].kind === "note" && items[0].agent).toBe("#5bbd2340");
  });
});
