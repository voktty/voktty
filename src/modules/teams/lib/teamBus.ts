import { readTextFile, writeTextFile } from "@/modules/harness/lib/fs";
import {
  getHarnessSessionSnapshot,
  sendHarnessSessionMessage,
} from "@/modules/harness/lib/harnessControlBridge";
import { invoke } from "@tauri-apps/api/core";
import type { TeamBusMessage, TeamBusState, TeamMessageKind } from "../types";
import { readTeamState, teamPath, writeTeamState } from "./teamFs";

const MAX_RATE_PER_MINUTE = 30;
const MAX_MESSAGE_BYTES = 16 * 1024; // 16 KiB
const MAX_HOP_COUNT = 5;

// In-memory rate limiting tracking: key = `${projectPath}:${agentName}` -> timestamps
const rateLimitMap = new Map<string, number[]>();

export function resetRateLimits(): void {
  rateLimitMap.clear();
}

function checkRateLimit(projectPath: string, agentName: string): void {
  const key = `${projectPath}:${agentName}`;
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = (rateLimitMap.get(key) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= MAX_RATE_PER_MINUTE) {
    throw new Error("rate_limited: rate limit exceeded (30 messages per minute)");
  }

  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
}

export async function readBus(projectPath: string): Promise<TeamBusState> {
  const filePath = teamPath(projectPath, ".voktty", "state", "bus.json");
  try {
    const raw = await readTextFile(filePath);
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.messages)) {
      return parsed as TeamBusState;
    }
  } catch {
    // Return empty starter
  }
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

export async function writeBus(
  projectPath: string,
  busState: TeamBusState,
): Promise<void> {
  const stateDir = teamPath(projectPath, ".voktty", "state");
  try {
    await invoke("fs_create_dir", { path: stateDir });
  } catch {
    // Ignore if directory already exists
  }
  const filePath = teamPath(stateDir, "bus.json");
  busState.updatedAt = new Date().toISOString();
  await writeTextFile(filePath, JSON.stringify(busState, null, 2));
}

export type SendMessageOptions = {
  projectPath: string;
  from: string;
  to: string;
  kind: TeamMessageKind;
  text: string;
  replyTo?: string;
};

export async function sendMessage(
  options: SendMessageOptions,
): Promise<TeamBusMessage> {
  const { projectPath, from, to, kind, text, replyTo } = options;

  // 1. Rate limiting
  checkRateLimit(projectPath, from);

  // 2. Message size
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > MAX_MESSAGE_BYTES) {
    throw new Error(
      `message_too_large: message exceeds maximum size of 16 KiB (${byteLength} bytes)`,
    );
  }

  // 3. Hop calculation
  const busState = await readBus(projectPath);
  let hop = 0;
  if (replyTo) {
    const parentMsg = busState.messages.find((m) => m.id === replyTo);
    if (parentMsg) {
      hop = parentMsg.hop + 1;
    } else {
      hop = 1;
    }
  }

  if (hop > MAX_HOP_COUNT) {
    throw new Error(
      `hop_limit_exceeded: message hop count ${hop} exceeds limit of ${MAX_HOP_COUNT}`,
    );
  }

  // Generate ID
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const message: TeamBusMessage = {
    id: messageId,
    projectPath,
    from,
    to,
    kind,
    text,
    timestamp: new Date().toISOString(),
    ...(replyTo ? { replyTo } : {}),
    hop,
    delivered: false,
    read: false,
  };

  // 4. Check recipient status in live team state
  const teamState = await readTeamState(projectPath);
  const targetAgent = teamState.agents[to];
  const targetSessionId = targetAgent?.sessionId;

  let delivered = false;
  if (targetSessionId) {
    let isWorking = false;
    try {
      const snap = getHarnessSessionSnapshot(targetSessionId);
      if (snap && snap.state === "working") {
        isWorking = true;
      }
    } catch {
      // If snapshot unavailable, attempt direct delivery
    }

    if (!isWorking) {
      try {
        await sendHarnessSessionMessage(targetSessionId, text);
        delivered = true;
      } catch {
        // Enqueue if failed
        delivered = false;
      }
    }
  }

  message.delivered = delivered;
  busState.messages.push(message);
  await writeBus(projectPath, busState);

  // 5. If verdict, update sender's lastVerdict and set status to idle in teamState
  if (kind === "verdict") {
    const senderAgent = teamState.agents[from] ?? { status: "idle" };
    senderAgent.lastVerdict = {
      text,
      timestamp: message.timestamp,
      messageId,
    };
    senderAgent.status = "idle";
    teamState.agents[from] = senderAgent;
    await writeTeamState(projectPath, teamState);
  }

  return message;
}

export async function deliverPendingMessages(
  projectPath: string,
  agentName: string,
): Promise<number> {
  const busState = await readBus(projectPath);
  const teamState = await readTeamState(projectPath);
  const sessionId = teamState.agents[agentName]?.sessionId;
  if (!sessionId) return 0;

  let isWorking = false;
  try {
    const snap = getHarnessSessionSnapshot(sessionId);
    if (snap && snap.state === "working") {
      isWorking = true;
    }
  } catch {
    // Ignore
  }

  if (isWorking) return 0;

  let count = 0;
  for (const msg of busState.messages) {
    if (msg.to === agentName && !msg.delivered) {
      try {
        await sendHarnessSessionMessage(sessionId, msg.text);
        msg.delivered = true;
        count++;
      } catch {
        break;
      }
    }
  }

  if (count > 0) {
    await writeBus(projectPath, busState);
  }

  return count;
}
