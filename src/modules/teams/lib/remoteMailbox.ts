import {
  listDir,
  readTextFile,
  writeTextFile,
  type FsEntry,
} from "@/modules/harness/lib/fs";
import type { TeamBusMessage, TeamMessageKind } from "../types";
import { normalizePath } from "./teamFs";

export type RemoteMailboxVerdict = {
  text: string;
  timestamp: string;
  messageId?: string;
  filePath: string;
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

export function remoteOutboxDir(
  remoteProjectCwd: string,
  agentName: string,
): string {
  return `${remoteMailboxDir(remoteProjectCwd, agentName)}/outbox`;
}

export type SafeMailboxMessagePayload = {
  id: string;
  from: string;
  to: string;
  kind: TeamMessageKind;
  text: string;
  timestamp: string;
  hop: number;
  replyTo?: string;
};

/**
 * Deposits a message in the remote agent's inbox.
 *
 * CRITICAL SECURITY INVARIANT:
 * The agent token NEVER travels over SSH, into remote mailbox files,
 * or across network arguments. Only message payload data is serialized.
 */
export async function writeRemoteMailboxMessage(
  remoteProjectCwd: string,
  agentName: string,
  message: TeamBusMessage,
  deps?: RemoteMailboxDeps,
): Promise<string> {
  assertSafeAgentName(agentName);
  const inbox = remoteInboxDir(remoteProjectCwd, agentName);
  const safeMessageId = message.id.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const filePath = `${inbox}/${safeMessageId}.json`;

  const payload: SafeMailboxMessagePayload = {
    id: message.id,
    from: message.from,
    to: message.to,
    kind: message.kind,
    text: message.text,
    timestamp: message.timestamp,
    hop: message.hop,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
  };

  // Explicit safety check: ensure no token or secret fields leak
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
 * Reads pending verdicts from the remote agent's outbox directory.
 */
export async function readRemoteMailboxVerdicts(
  remoteProjectCwd: string,
  agentName: string,
  deps?: RemoteMailboxDeps,
): Promise<RemoteMailboxVerdict[]> {
  assertSafeAgentName(agentName);
  const outbox = remoteOutboxDir(remoteProjectCwd, agentName);
  const lister = deps?.listDir ?? listDir;
  const reader = deps?.readTextFile ?? readTextFile;

  let entries: FsEntry[] = [];
  try {
    entries = await lister(outbox);
  } catch {
    // Directory might not exist yet or empty
    return [];
  }

  const verdicts: RemoteMailboxVerdict[] = [];
  for (const entry of entries) {
    if (entry.isDir || !entry.name.endsWith(".json")) continue;
    try {
      const content = await reader(entry.path);
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (parsed && typeof parsed.text === "string") {
        verdicts.push({
          text: parsed.text,
          timestamp:
            typeof parsed.timestamp === "string"
              ? parsed.timestamp
              : new Date().toISOString(),
          messageId:
            typeof parsed.messageId === "string" ? parsed.messageId : undefined,
          filePath: entry.path,
        });
      }
    } catch {
      // Ignore unparseable files
    }
  }

  // Sort newest first
  verdicts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return verdicts;
}

/**
 * Reads the latest verdict from the agent's outbox.
 */
export async function readLatestRemoteMailboxVerdict(
  remoteProjectCwd: string,
  agentName: string,
  deps?: RemoteMailboxDeps,
): Promise<RemoteMailboxVerdict | null> {
  const verdicts = await readRemoteMailboxVerdicts(remoteProjectCwd, agentName, deps);
  return verdicts[0] ?? null;
}
