import {
  parseRemotePath,
  remotePath,
} from "@/modules/connections/model/remoteProjects";
import type { SessionRecord, SessionSummary, SessionUpsertPayload } from "./sessionStore";

/**
 * Conversations of a project on an SSH host live in that project, under
 * `.voktty/`, so the folder carries its own history wherever it is opened from.
 *
 *   .voktty/.gitignore          `*`, so the folder never shows up in Git
 *   .voktty/sessions/<id>.json        the full conversation
 *   .voktty/sessions/<id>.meta.json   its summary, small enough to list quickly
 */
export const VOKTTY_DIR = ".voktty";
export const SESSIONS_DIR = ".voktty/sessions";
const GITIGNORE = ".voktty/.gitignore";
const GITIGNORE_BODY = "*\n";
const RECORD_SUFFIX = ".json";
const META_SUFFIX = ".meta.json";
const SCHEMA_VERSION = 1;
/** The helper refuses to read files above 8 MiB, so a record must stay below. */
export const MAX_RECORD_BYTES = 6 * 1024 * 1024;
export const MAX_LISTED_SESSIONS = 200;

/** What the store needs from the host. Paths are relative to the project root. */
export type RemoteStoreIo = {
  /** `null` when the file does not exist. */
  read: (path: string) => Promise<string | null>;
  /** Creates missing parent folders. */
  write: (path: string, content: string) => Promise<void>;
  /** File names directly inside a folder; empty when it does not exist. */
  list: (path: string) => Promise<string[]>;
  /** Succeeds when the file is already gone. */
  remove: (path: string) => Promise<void>;
};

type StoredMeta = SessionSummary & { version: number };
type StoredRecord = SessionRecord & { version: number; truncatedBlocks?: number };

const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isStorableId(value: string): boolean {
  return ID.test(value);
}

/**
 * Saved folders are written as plain host paths. The connection that reaches a
 * host is a local choice, so the same folder opened from another computer or
 * profile must resolve to that connection instead of the one that wrote it.
 */
export function toPortablePath(path: string): string {
  return parseRemotePath(path)?.hostPath ?? path;
}

export function fromPortablePath(stored: string, environmentId: string): string {
  const remote = parseRemotePath(stored);
  const hostPath = remote ? remote.hostPath : stored;
  return hostPath.startsWith("/") ? remotePath(environmentId, hostPath) : stored;
}

export function portablePayload(payload: SessionUpsertPayload): SessionUpsertPayload {
  return {
    ...payload,
    cwd: toPortablePath(payload.cwd),
    ...(payload.worktreeCwd
      ? { worktreeCwd: toPortablePath(payload.worktreeCwd) }
      : {}),
  };
}

export function localizeSummary(
  summary: SessionSummary,
  environmentId: string,
): SessionSummary {
  return { ...summary, cwd: fromPortablePath(summary.cwd, environmentId) };
}

export function localizeRecord(
  record: SessionRecord,
  environmentId: string,
): SessionRecord {
  return {
    ...record,
    cwd: fromPortablePath(record.cwd, environmentId),
    ...(record.worktreeCwd
      ? { worktreeCwd: fromPortablePath(record.worktreeCwd, environmentId) }
      : {}),
  };
}

function recordPath(id: string): string {
  return `${SESSIONS_DIR}/${id}${RECORD_SUFFIX}`;
}

function metaPath(id: string): string {
  return `${SESSIONS_DIR}/${id}${META_SUFFIX}`;
}

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

/** Keeps the newest blocks that fit; returns how many older ones were dropped. */
export function fitBlocks<T>(
  blocks: readonly T[],
  budgetBytes: number,
): { blocks: T[]; dropped: number } {
  const sizes = blocks.map((block) => byteLength(JSON.stringify(block)) + 1);
  let total = sizes.reduce((sum, size) => sum + size, 0);
  let start = 0;
  while (start < blocks.length - 1 && total > budgetBytes) {
    total -= sizes[start];
    start += 1;
  }
  return { blocks: blocks.slice(start), dropped: start };
}

export function summaryFromPayload(
  payload: SessionUpsertPayload,
  previous: SessionSummary | undefined,
  now: number,
): SessionSummary {
  return {
    id: payload.id,
    cwd: payload.cwd,
    harness: payload.harness as SessionSummary["harness"],
    model: payload.model,
    runtimeMode: payload.runtimeMode as SessionSummary["runtimeMode"],
    title: payload.title,
    ...(payload.providerSessionId
      ? { providerSessionId: payload.providerSessionId }
      : {}),
    ...(payload.branch ? { branch: payload.branch } : {}),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    ...(previous?.archived ? { archived: true } : {}),
    ...(previous?.pinned ? { pinned: true } : {}),
    ...(payload.linkedWorkItem ? { linkedWorkItem: payload.linkedWorkItem } : {}),
    ...(payload.automationId ? { automationId: payload.automationId } : {}),
  };
}

export function recordFromPayload(
  payload: SessionUpsertPayload,
  summary: SessionSummary,
  blocks: SessionUpsertPayload["blocks"],
  dropped: number,
): StoredRecord {
  return {
    version: SCHEMA_VERSION,
    id: payload.id,
    cwd: payload.cwd,
    harness: payload.harness,
    model: payload.model,
    modelSettings: payload.modelSettings,
    runtimeMode: payload.runtimeMode,
    title: payload.title,
    providerSessionId: payload.providerSessionId ?? null,
    providerAccountId: payload.providerAccountId ?? null,
    blocks,
    contextUsed: payload.contextUsed ?? null,
    contextWindow: payload.contextWindow ?? null,
    branch: payload.branch ?? null,
    worktreeCwd: payload.worktreeCwd ?? null,
    linkedWorkItem: payload.linkedWorkItem ?? null,
    automationId: payload.automationId ?? null,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    ...(dropped > 0 ? { truncatedBlocks: dropped } : {}),
  };
}

function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A damaged or foreign file is skipped, never trusted. */
export function parseMeta(text: string | null, id: string): SessionSummary | undefined {
  const value = asObject(parseJson(text));
  if (
    !value ||
    value.id !== id ||
    typeof value.cwd !== "string" ||
    typeof value.harness !== "string" ||
    typeof value.title !== "string" ||
    typeof value.updatedAt !== "number" ||
    typeof value.createdAt !== "number"
  ) {
    return undefined;
  }
  const { version: _version, ...summary } = value as StoredMeta;
  return summary as SessionSummary;
}

export function parseRecord(text: string | null, id: string): SessionRecord | undefined {
  const value = asObject(parseJson(text));
  if (!value || value.id !== id || !Array.isArray(value.blocks)) return undefined;
  const { version: _version, truncatedBlocks: _dropped, ...record } = value as StoredRecord;
  return record as SessionRecord;
}

export function createRemoteSessionStore(io: RemoteStoreIo, clock: () => number = Date.now) {
  let prepared = false;

  async function ensureFolder(): Promise<void> {
    if (prepared) return;
    if ((await io.read(GITIGNORE)) === null) {
      await io.write(GITIGNORE, GITIGNORE_BODY);
    }
    prepared = true;
  }

  async function readMeta(id: string): Promise<SessionSummary | undefined> {
    return parseMeta(await io.read(metaPath(id)), id);
  }

  async function writeMeta(summary: SessionSummary): Promise<void> {
    const stored: StoredMeta = { ...summary, version: SCHEMA_VERSION };
    await io.write(metaPath(summary.id), JSON.stringify(stored));
  }

  return {
    async upsert(payload: SessionUpsertPayload): Promise<SessionSummary> {
      if (!isStorableId(payload.id)) throw new Error("Invalid session id.");
      await ensureFolder();
      const previous = await readMeta(payload.id);
      const summary = summaryFromPayload(payload, previous, clock());
      const { blocks, dropped } = fitBlocks(payload.blocks, MAX_RECORD_BYTES);
      // The conversation goes first: a summary must never point at a missing record.
      await io.write(
        recordPath(payload.id),
        JSON.stringify(recordFromPayload(payload, summary, blocks, dropped)),
      );
      await writeMeta(summary);
      return summary;
    },

    /** Newest first, capped, skipping files that do not parse. */
    async list(): Promise<SessionSummary[]> {
      const names = await io.list(SESSIONS_DIR);
      const ids = names
        .filter((name) => name.endsWith(META_SUFFIX))
        .map((name) => name.slice(0, -META_SUFFIX.length))
        .filter(isStorableId);
      const found = await Promise.all(ids.map((id) => readMeta(id).catch(() => undefined)));
      return found
        .filter((summary): summary is SessionSummary => summary !== undefined)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_LISTED_SESSIONS);
    },

    async get(id: string): Promise<SessionRecord | null> {
      if (!isStorableId(id)) return null;
      const record = parseRecord(await io.read(recordPath(id)), id);
      if (!record) return null;
      const meta = await readMeta(id);
      return { ...record, ...(meta ? { updatedAt: meta.updatedAt } : {}) };
    },

    async remove(id: string): Promise<void> {
      if (!isStorableId(id)) return;
      await io.remove(metaPath(id));
      await io.remove(recordPath(id));
    },

    async setFlag(id: string, flag: "archived" | "pinned", value: boolean): Promise<void> {
      if (!isStorableId(id)) return;
      const meta = await readMeta(id);
      if (!meta) return;
      const next: SessionSummary = { ...meta };
      if (value) next[flag] = true;
      else delete next[flag];
      await writeMeta(next);
    },
  };
}

export type RemoteSessionStore = ReturnType<typeof createRemoteSessionStore>;
