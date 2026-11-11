import {
  listDir,
  readTextFile,
  writeTextFile,
  type FsEntry,
} from "@/modules/harness/lib/fs";
import type { TeamMessageKind } from "../types";
import { normalizePath } from "./teamFs";

export const MAX_MAILBOX_READ_FILES = 50;
export const MAX_MAILBOX_FILE_BYTES = 64 * 1024; // 64 KiB

/**
 * Message payload format strictly complying with templates/workspace-kit/dot-voktty/team/MESSAGING.md:
 * {
 *   "from": string,
 *   "to": string,
 *   "kind": "task" | "verdict" | "decision" | "blocker" | "status" | "question",
 *   "text": string,
 *   "sentAt": string (ISO 8601 UTC)
 * }
 */
export type KitMailboxMessage = {
  from: string;
  to: string;
  kind: TeamMessageKind;
  text: string;
  sentAt: string;
};

export type RemoteMailboxDeps = {
  writeTextFile?: (path: string, content: string) => Promise<void>;
  readTextFile?: (path: string) => Promise<string>;
  listDir?: (path: string) => Promise<FsEntry[]>;
};

export function assertSafeAgentName(agentName: string): void {
  if (!agentName || typeof agentName !== "string") {
    throw new Error("Agent name must be a non-empty string");
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(agentName)) {
    throw new Error(`Invalid agent name '${agentName}' for mailbox directory`);
  }
}

export function remoteMailboxDir(
  remoteProjectCwd: string,
  agentName: string,
): string {
  assertSafeAgentName(agentName);
  const base = normalizePath(remoteProjectCwd);
  return `${base}/.voktty/mailbox/${agentName}`;
}

export function remoteInboxDir(
  remoteProjectCwd: string,
  agentName: string,
): string {
  return `${remoteMailboxDir(remoteProjectCwd, agentName)}/inbox`;
}

/**
 * Generates a unique mailbox filename matching MESSAGING.md:
 * `<UTC timestamp>-<sender>-<unique suffix>.json`
 */
export function generateMailboxFileName(
  sender: string,
  sentAtDate: Date = new Date(),
): string {
  const utcStr = sentAtDate.toISOString().replace(/[:.]/g, "-");
  const safeSender = sender.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${utcStr}-${safeSender}-${suffix}.json`;
}

/**
 * Deposits a message in the remote agent's inbox in exact MESSAGING.md format:
 * File: .voktty/mailbox/<recipient>/inbox/<UTC>-<sender>-<suffix>.json
 * Fields: from, to, kind, text, sentAt.
 *
 * CRITICAL SECURITY INVARIANTS:
 * - The agent token NEVER travels into mailbox files or remote storage.
 * - Writing to mailbox is NEVER proof of delivery (S1).
 * - No outbox directory is created or used (S2).
 */
export async function writeRemoteMailboxMessage(
  remoteProjectCwd: string,
  recipient: string,
  message: {
    from: string;
    to: string;
    kind: TeamMessageKind;
    text: string;
    sentAt?: string;
  },
  deps?: RemoteMailboxDeps,
): Promise<string> {
  assertSafeAgentName(recipient);
  const inbox = remoteInboxDir(remoteProjectCwd, recipient);
  const sentAt = message.sentAt || new Date().toISOString();
  const sentAtDate = new Date(sentAt);
  const filename = generateMailboxFileName(
    message.from,
    Number.isNaN(sentAtDate.getTime()) ? new Date() : sentAtDate,
  );
  const filePath = `${inbox}/${filename}`;

  // S2: Exact fields per MESSAGING.md, no outbox, no id, no hop, no token
  const payload: KitMailboxMessage = {
    from: message.from,
    to: message.to,
    kind: message.kind,
    text: message.text,
    sentAt,
  };

  // Explicit safety check: ensure no credentials or tokens leak
  const raw = payload as Record<string, unknown>;
  delete raw.token;
  delete raw.agentToken;
  delete raw.password;
  delete raw.secret;

  const writer = deps?.writeTextFile ?? writeTextFile;
  await writer(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

/**
 * Reads messages from the remote agent's inbox directory with bounded resources (I1).
 *
 * Invariants:
 * - Bounded: limits to at most MAX_MAILBOX_READ_FILES (50).
 * - Bounded size: skips any file exceeding MAX_MAILBOX_FILE_BYTES (64 KiB).
 * - S3: Never alters lastVerdict, never alters agent state.
 */
export async function readRemoteInboxMessages(
  remoteProjectCwd: string,
  agentName: string,
  deps?: RemoteMailboxDeps,
): Promise<KitMailboxMessage[]> {
  assertSafeAgentName(agentName);
  const inbox = remoteInboxDir(remoteProjectCwd, agentName);
  const lister = deps?.listDir ?? listDir;
  const reader = deps?.readTextFile ?? readTextFile;

  let entries: FsEntry[] = [];
  try {
    entries = await lister(inbox);
  } catch {
    return [];
  }

  // Filter valid .json files, bounded to MAX_MAILBOX_READ_FILES (I1)
  const jsonFiles = entries
    .filter((e) => !e.isDir && e.name.endsWith(".json"))
    .slice(0, MAX_MAILBOX_READ_FILES);

  const messages: KitMailboxMessage[] = [];
  for (const entry of jsonFiles) {
    try {
      const content = await reader(entry.path);
      // Byte size protection (I1)
      if (new TextEncoder().encode(content).length > MAX_MAILBOX_FILE_BYTES) {
        continue;
      }
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (
        parsed &&
        typeof parsed.from === "string" &&
        typeof parsed.to === "string" &&
        typeof parsed.kind === "string" &&
        typeof parsed.text === "string" &&
        typeof parsed.sentAt === "string"
      ) {
        messages.push({
          from: parsed.from,
          to: parsed.to,
          kind: parsed.kind as TeamMessageKind,
          text: parsed.text,
          sentAt: parsed.sentAt,
        });
      }
    } catch {
      // Ignore unparseable files
    }
  }

  messages.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  return messages;
}
