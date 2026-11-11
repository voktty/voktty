import type {
  FeedRecord,
  FeedResponse,
  LiveSession,
  TranscriptSpan,
} from "./types";

/** Most records kept in memory; older ones are dropped first. */
export const MAX_FEED_RECORDS = 5000;
/** A send and its receipt are the same message within this window. */
const PAIR_WINDOW_MS = 120_000;
const PAIR_KEY_CHARS = 200;

export type FeedState = {
  records: Map<string, FeedRecord>;
  sessions: Map<string, LiveSession>;
  spans: Map<string, { firstTs: string | null; lastTs: string | null }>;
  unrecognized: number;
};

export type AgentStatus = "busy" | "idle" | "shell" | "gone" | "unknown";

export type FeedAgent = {
  name: string;
  sessionIds: string[];
  status: AgentStatus;
  tmux: string | null;
  orchestrator: boolean;
  lastTs: string | null;
};

export type TimelineItem =
  | {
      kind: "message";
      id: string;
      ts: string;
      from: string;
      to: string;
      summary: string | null;
      text: string;
      truncated: boolean;
      delivered: boolean;
    }
  | AgentWords<"note">
  | AgentWords<"human">
  | { kind: "joined"; id: string; ts: string; agent: string }
  | { kind: "left"; id: string; ts: string; agent: string };

type AgentWords<K extends "note" | "human"> = {
  kind: K;
  id: string;
  ts: string;
  agent: string;
  text: string;
  truncated: boolean;
};

export type Timeline = { agents: FeedAgent[]; items: TimelineItem[] };

export function emptyFeed(): FeedState {
  return {
    records: new Map(),
    sessions: new Map(),
    spans: new Map(),
    unrecognized: 0,
  };
}

function newerSession(a: LiveSession, b: LiveSession): LiveSession {
  if ((a.alive === false) !== (b.alive === false))
    return a.alive === false ? b : a;
  return (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a;
}

/** Folds one poll into the accumulated feed. Returns a new state. */
export function mergeFeed(state: FeedState, response: FeedResponse): FeedState {
  const records = new Map(state.records);
  for (const record of response.records) records.set(record.id, record);
  if (records.size > MAX_FEED_RECORDS) {
    const sorted = [...records.values()].sort(byTsThenId);
    for (const record of sorted.slice(0, records.size - MAX_FEED_RECORDS))
      records.delete(record.id);
  }
  // Sessions are a snapshot of what is live now, not an accumulation.
  const sessions = new Map<string, LiveSession>();
  for (const session of response.sessions) {
    const previous = sessions.get(session.sessionId);
    sessions.set(
      session.sessionId,
      previous ? newerSession(previous, session) : session,
    );
  }
  const spans = new Map(state.spans);
  for (const span of response.transcripts) mergeSpan(spans, span);
  return {
    records,
    sessions,
    spans,
    unrecognized: state.unrecognized + response.unrecognized,
  };
}

function mergeSpan(spans: FeedState["spans"], span: TranscriptSpan) {
  const previous = spans.get(span.sessionId);
  const first =
    [previous?.firstTs, span.firstTs].filter((v): v is string => !!v).sort()[0] ??
    null;
  const lasts = [previous?.lastTs, span.lastTs]
    .filter((v): v is string => !!v)
    .sort();
  const last = lasts[lasts.length - 1] ?? null;
  spans.set(span.sessionId, { firstTs: first, lastTs: last });
}

function byTsThenId(a: { ts: string; id: string }, b: { ts: string; id: string }) {
  return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function pairKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, PAIR_KEY_CHARS);
}

function ms(ts: string): number {
  const value = Date.parse(ts);
  return Number.isNaN(value) ? 0 : value;
}

const ORCHESTRATOR_NAME = /orquest|orchestr/i;

/** Names, pairing and the ordered timeline. Pure. */
export function buildTimeline(state: FeedState): Timeline {
  const records = [...state.records.values()].sort(byTsThenId);
  const nameBySession = new Map<string, string>();
  const nameByPid = new Map<number, string>();
  for (const session of state.sessions.values()) {
    if (!session.name) continue;
    nameBySession.set(session.sessionId, session.name);
    nameByPid.set(session.pid, session.name);
  }
  for (const record of records)
    if (record.kind === "recv" && record.peerPid != null && record.peer)
      nameByPid.set(record.peerPid, record.peer);

  // Pair each send with the receipt of the same text in another session.
  const receipts = new Map<string, FeedRecord[]>();
  for (const record of records) {
    if (record.kind !== "recv") continue;
    const key = pairKey(record.text);
    receipts.set(key, [...(receipts.get(key) ?? []), record]);
  }
  const pairedRecv = new Set<string>();
  const pairs = new Map<string, FeedRecord>();
  for (const send of records) {
    if (send.kind !== "send") continue;
    const candidates = receipts.get(pairKey(send.text)) ?? [];
    const match = candidates.find(
      (recv) =>
        !pairedRecv.has(recv.id) &&
        recv.sessionId !== send.sessionId &&
        Math.abs(ms(recv.ts) - ms(send.ts)) <= PAIR_WINDOW_MS,
    );
    if (!match) continue;
    pairedRecv.add(match.id);
    pairs.set(send.id, match);
  }

  // A pair names both ends: the receipt carries the sender's name, the send
  // addresses the receiver by name.
  for (const [sendId, recv] of pairs) {
    const send = state.records.get(sendId);
    if (!send) continue;
    if (!nameBySession.has(send.sessionId) && recv.peer)
      nameBySession.set(send.sessionId, recv.peer);
    if (!nameBySession.has(recv.sessionId) && send.peerPid == null && send.peer)
      nameBySession.set(recv.sessionId, send.peer);
  }

  const display = (sessionId: string) =>
    nameBySession.get(sessionId) ?? `#${sessionId.slice(0, 8)}`;
  const recipient = (send: FeedRecord, recv: FeedRecord | undefined) => {
    if (send.peerPid != null) {
      const byPid = nameByPid.get(send.peerPid);
      if (byPid) return byPid;
      if (recv) return display(recv.sessionId);
    }
    return send.peer;
  };

  const items: TimelineItem[] = [];
  for (const record of records) {
    const base = { id: record.id, ts: record.ts, truncated: record.truncated };
    if (record.kind === "send") {
      const recv = pairs.get(record.id);
      items.push({
        ...base,
        kind: "message",
        from: display(record.sessionId),
        to: recipient(record, recv),
        summary: record.summary,
        text: record.text,
        delivered: recv !== undefined,
      });
    } else if (record.kind === "recv") {
      if (pairedRecv.has(record.id)) continue;
      items.push({
        ...base,
        kind: "message",
        from: record.peer,
        to: display(record.sessionId),
        summary: null,
        text: record.text,
        delivered: true,
      });
    } else {
      const words = { ...base, agent: display(record.sessionId), text: record.text };
      items.push(record.kind === "note" ? { ...words, kind: "note" } : { ...words, kind: "human" });
    }
  }

  // Arrivals and departures from transcript spans and the live snapshot.
  const knownSessions = new Set<string>([
    ...records.map((r) => r.sessionId),
    ...state.sessions.keys(),
  ]);
  for (const sessionId of knownSessions) {
    const span = state.spans.get(sessionId);
    const agent = display(sessionId);
    if (span?.firstTs)
      items.push({ kind: "joined", id: `joined:${sessionId}`, ts: span.firstTs, agent });
    const live = state.sessions.get(sessionId);
    if (span?.lastTs && (!live || live.alive === false))
      items.push({ kind: "left", id: `left:${sessionId}`, ts: span.lastTs, agent });
  }
  // At the same instant a session arrives before it speaks and leaves after.
  const rank = (item: TimelineItem) =>
    item.kind === "joined" ? 0 : item.kind === "left" ? 2 : 1;
  items.sort((a, b) =>
    a.ts !== b.ts ? (a.ts < b.ts ? -1 : 1) : rank(a) - rank(b) || byTsThenId(a, b),
  );

  return { agents: collectAgents(state, knownSessions, display, items), items };
}

function collectAgents(
  state: FeedState,
  sessionIds: Set<string>,
  display: (sessionId: string) => string,
  items: TimelineItem[],
): FeedAgent[] {
  const agents = new Map<string, FeedAgent>();
  for (const sessionId of sessionIds) {
    const name = display(sessionId);
    const agent = agents.get(name) ?? {
      name,
      sessionIds: [],
      status: "gone" as AgentStatus,
      tmux: null,
      orchestrator: false,
      lastTs: null,
    };
    agent.sessionIds.push(sessionId);
    const live = state.sessions.get(sessionId);
    if (live && live.alive !== false) {
      agent.status = liveStatus(live.status);
      agent.tmux = live.tmux ?? agent.tmux;
    }
    const lastTs = state.spans.get(sessionId)?.lastTs ?? null;
    if (lastTs && (!agent.lastTs || lastTs > agent.lastTs)) agent.lastTs = lastTs;
    agents.set(name, agent);
  }
  const list = [...agents.values()];
  const named = list.filter((agent) => ORCHESTRATOR_NAME.test(agent.name));
  if (named.length > 0) {
    for (const agent of named) agent.orchestrator = true;
  } else {
    // Whoever hands out work to two or more agents leads the team.
    const recipients = new Map<string, Set<string>>();
    for (const item of items)
      if (item.kind === "message")
        recipients.set(item.from, (recipients.get(item.from) ?? new Set()).add(item.to));
    const lead = [...recipients.entries()]
      .filter(([, to]) => to.size >= 2)
      .sort((a, b) => b[1].size - a[1].size)[0];
    const leader = lead ? list.find((agent) => agent.name === lead[0]) : undefined;
    if (leader) leader.orchestrator = true;
  }
  return list.sort(
    (a, b) =>
      Number(b.orchestrator) - Number(a.orchestrator) ||
      Number(a.status === "gone") - Number(b.status === "gone") ||
      a.name.localeCompare(b.name),
  );
}

function liveStatus(status: string | null): AgentStatus {
  return status === "busy" || status === "idle" || status === "shell"
    ? status
    : "unknown";
}
