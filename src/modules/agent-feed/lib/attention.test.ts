import { describe, expect, it } from "vitest";
import { asksForOwner, emptyWatchState, foldWatch, watchSources } from "./attention";
import { unseenAttention } from "./attentionStore";
import type { FeedRecord, FeedResponse, LiveSession } from "./types";

const SOURCE = { key: "ssh:mini", label: "miniserver" };

function session(id: string, name: string | null, status = "idle"): LiveSession {
  return {
    pid: 1,
    sessionId: id,
    name,
    cwd: "/srv",
    status,
    tmux: null,
    version: null,
    updatedAt: null,
    alive: true,
  };
}

function record(id: string, sessionId: string, kind: FeedRecord["kind"], text: string, ts: string): FeedRecord {
  return { id, kind, ts, sessionId, peer: "", peerPid: null, summary: null, text, truncated: false };
}

function response(sessions: LiveSession[], records: FeedRecord[]): FeedResponse {
  return {
    available: true,
    sessions,
    transcripts: [],
    records,
    cursor: { files: { a: records.length } },
    truncated: false,
    unrecognized: 0,
  };
}

describe("asksForOwner", () => {
  it.each([
    "CRM 280: tengo el plan corto escrito. Espero tu OK para empezar a programar.",
    "Lo dejo así salvo que me digas otra cosa.",
    "Una comprobación que solo puedes hacer tú: entra con tu cuenta.",
    "Todo verde.\n\n¿Lo despliego?",
    "I need your approval before pushing.",
    "Should I deploy now",
  ])("flags %s", (text) => expect(asksForOwner(text)).toBe(true));

  it.each([
    "He aprobado el plan de la 280 y panel-crm ya está programando.",
    "Le he preguntado a nodo si la roja es de producto. Sigo con la 281.",
    "Tests green on abc1234, deployed.",
  ])("ignores %s", (text) => expect(asksForOwner(text)).toBe(false));
});

describe("foldWatch", () => {
  it("reports an idle named agent whose last words ask the owner", () => {
    const { waiting } = foldWatch(
      emptyWatchState(),
      response(
        [session("o", "orquestador"), session("n", "nodo", "busy"), session("x", null)],
        [
          record("r1", "o", "note", "¿Lo despliego?", "2026-11-11T15:00:00Z"),
          record("r2", "n", "note", "¿Sigo?", "2026-11-11T15:00:00Z"),
          record("r3", "x", "note", "¿Sigo?", "2026-11-11T15:00:00Z"),
        ],
      ),
      SOURCE,
    );
    expect(waiting).toEqual([
      expect.objectContaining({ key: "ssh:mini:o", recordId: "r1", agent: "orquestador", host: "miniserver" }),
    ]);
  });

  it("clears the question once the owner answers or the agent moves on", () => {
    const first = foldWatch(
      emptyWatchState(),
      response([session("o", "orquestador")], [record("r1", "o", "note", "Espero tu OK.", "2026-11-11T15:00:00Z")]),
      SOURCE,
    );
    expect(first.waiting).toHaveLength(1);
    const answered = foldWatch(
      first.state,
      response([session("o", "orquestador")], [record("h1", "o", "human", "vale, adelante", "2026-11-11T15:01:00Z")]),
      SOURCE,
    );
    expect(answered.waiting).toEqual([]);
    expect(answered.state.cursor).toEqual({ files: { a: 1 } });
  });

  it("forgets sessions that ended", () => {
    const first = foldWatch(
      emptyWatchState(),
      response([session("o", "orquestador")], [record("r1", "o", "note", "Espero tu OK.", "2026-11-11T15:00:00Z")]),
      SOURCE,
    );
    const gone = foldWatch(first.state, response([], []), SOURCE);
    expect(gone.waiting).toEqual([]);
    expect(gone.state.latest).toEqual({});
  });
});

describe("watchSources", () => {
  const ssh = (id: string, sessionId?: number) => ({
    kind: "ssh" as const,
    connection: { id, name: id === "mini" ? "miniserver" : "", host: `${id}.lan` } as never,
    root: "/",
    sessionId,
  });

  it("keeps one source per machine and skips disconnected SSH tabs", () => {
    const sources = watchSources([
      { env: { kind: "local" }, tabId: 1, leafId: 10 },
      { env: ssh("mini", 7), tabId: 2, leafId: 20 },
      { env: ssh("mini", 7), tabId: 3, leafId: 30 },
      { env: ssh("other"), tabId: 4, leafId: 40 },
      { env: { kind: "local" }, tabId: 5, leafId: 50 },
    ]);
    expect(sources.map((s) => [s.key, s.label, s.tabId])).toEqual([
      ["local", "", 1],
      ["ssh:mini", "miniserver", 2],
    ]);
  });

  it("counts only questions the owner has not seen", () => {
    const item = { key: "k", sourceKey: "local", recordId: "r1", agent: "a", host: "", text: "?", ts: "", cwd: null };
    expect(unseenAttention({ bySource: { local: [item] }, seen: {} })).toHaveLength(1);
    expect(unseenAttention({ bySource: { local: [item] }, seen: { r1: true } })).toHaveLength(0);
  });
});
