import type { WorkspaceEnv } from "@/modules/workspace";
import type { FeedCursor, FeedRecord, FeedResponse } from "./types";

/**
 * Phrases an agent uses when it stops for the owner. Spanish and English,
 * matched on its words to the owner (notes), never on agent-to-agent
 * messages. A heuristic: the session's status gates it (a busy agent is
 * not waiting) and the owner's next prompt clears it.
 */
const ASKS_FOR_OWNER: RegExp[] = [
  /\bespero (a )?tus? (ok|okey|visto bueno|confirmaci[oó]n|respuesta|decisi[oó]n|aprobaci[oó]n|orden|se[nñ]al)\b/i,
  /\b(necesito|me hace falta) (tu|que (me )?(digas|confirmes|decidas|apruebes|elijas))\b/i,
  /\bsalvo que me digas\b/i,
  /\bs[oó]lo (puedes|podr[aá]s) (hacer|comprobar|decidir)(lo|la)? t[uú](?![a-z])/i,
  /\bs[oó]lo t[uú] puedes\b/i,
  /\b(dime|d[ií]melo|conf[ií]rmame) (si|qu[eé]|cu[aá]l)\b/i,
  /\bpregunta (abierta )?para ti\b/i,
  /\bwaiting (for|on) your\b/i,
  /\bneeds? your (ok|approval|input|decision|confirmation|go-ahead)\b/i,
  /\blet me know (if|whether|which|what)\b/i,
  /\bshould i (deploy|proceed|continue|push|merge|ship|go ahead)\b/i,
  /\bonly you can\b/i,
  /\byour call\b/i,
];

/** The agent's words end in a question or ask the owner for something. */
export function asksForOwner(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  if (/\?\s*\**$/.test(last)) return true;
  // The ask closes the message; the same words earlier in a long report
  // usually describe what someone else waits for.
  const tail = text.slice(-ASK_TAIL_CHARS);
  return ASKS_FOR_OWNER.some((pattern) => pattern.test(tail));
}

const ASK_TAIL_CHARS = 320;

/** One host to watch: the local machine or one open SSH connection. */
export type WatchSource = {
  key: string;
  label: string;
  env: WorkspaceEnv;
  tabId: number;
  leafId: number;
};

type SourceCandidate = { env: WorkspaceEnv; tabId: number; leafId: number };

/**
 * The hosts behind the open tabs, one per machine. An SSH connection is
 * watched only while a tab holds a live session on it; nothing here opens
 * a connection.
 */
export function watchSources(candidates: readonly SourceCandidate[]): WatchSource[] {
  const byKey = new Map<string, WatchSource>();
  for (const { env, tabId, leafId } of candidates) {
    if (env.kind === "local") {
      if (!byKey.has("local")) byKey.set("local", { key: "local", label: "", env, tabId, leafId });
    } else if (env.kind === "ssh" && env.sessionId != null) {
      const key = `ssh:${env.connection.id}`;
      if (!byKey.has(key))
        byKey.set(key, {
          key,
          label: env.connection.name || env.connection.host,
          env,
          tabId,
          leafId,
        });
    }
  }
  return [...byKey.values()];
}

export type AttentionItem = {
  /** `<source key>:<session id>`: one pending question per agent. */
  key: string;
  sourceKey: string;
  recordId: string;
  agent: string;
  host: string;
  text: string;
  ts: string;
};

export type WatchState = {
  cursor: FeedCursor | null;
  /** Latest record per session, any kind: an answer or new work supersedes a question. */
  latest: Record<string, FeedRecord>;
};

export function emptyWatchState(): WatchState {
  return { cursor: null, latest: {} };
}

/**
 * Folds one poll into the source's state and returns the agents that wait
 * for the owner now: a named live session that is not busy and whose last
 * record is its own question to the owner.
 */
export function foldWatch(
  state: WatchState,
  response: FeedResponse,
  source: Pick<WatchSource, "key" | "label">,
): { state: WatchState; waiting: AttentionItem[] } {
  const latest = { ...state.latest };
  for (const record of response.records) {
    const current = latest[record.sessionId];
    if (!current || record.ts >= current.ts) latest[record.sessionId] = record;
  }
  const waiting: AttentionItem[] = [];
  const live = new Set<string>();
  for (const session of response.sessions) {
    if (!session.name || session.alive === false) continue;
    live.add(session.sessionId);
    const last = latest[session.sessionId];
    if (!last || last.kind !== "note" || session.status === "busy") continue;
    if (!asksForOwner(last.text)) continue;
    waiting.push({
      key: `${source.key}:${session.sessionId}`,
      sourceKey: source.key,
      recordId: last.id,
      agent: session.name,
      host: source.label,
      text: last.text,
      ts: last.ts,
    });
  }
  // Forget sessions that ended so the state stays bounded.
  for (const sessionId of Object.keys(latest)) if (!live.has(sessionId)) delete latest[sessionId];
  return { state: { cursor: response.cursor, latest }, waiting };
}
