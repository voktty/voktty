/** Mirrors `voktty_agent_feed` (src-tauri/crates/voktty-agent-feed). */

export type FeedCursor = { files: Record<string, number> };

export type FeedScope = "project" | "host";

export type FeedRequest = {
  root: string;
  scope: FeedScope;
  sinceMs: number;
  cursor?: FeedCursor | null;
};

export type LiveSession = {
  pid: number;
  sessionId: string;
  name: string | null;
  cwd: string | null;
  status: string | null;
  tmux: string | null;
  version: string | null;
  updatedAt: number | null;
  alive: boolean | null;
};

export type TranscriptSpan = {
  sessionId: string;
  firstTs: string | null;
  lastTs: string | null;
};

export type RecordKind = "send" | "recv" | "note" | "human";

export type FeedRecord = {
  id: string;
  kind: RecordKind;
  ts: string;
  sessionId: string;
  peer: string;
  peerPid: number | null;
  summary: string | null;
  text: string;
  truncated: boolean;
};

export type FeedResponse = {
  available: boolean;
  sessions: LiveSession[];
  transcripts: TranscriptSpan[];
  records: FeedRecord[];
  cursor: FeedCursor;
  truncated: boolean;
  unrecognized: number;
};
