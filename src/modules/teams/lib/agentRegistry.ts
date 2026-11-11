import { useSyncExternalStore } from "react";
import type { LiveAgentSession } from "../types";

const sessionsById = new Map<string, LiveAgentSession>();
const sessionsByToken = new Map<string, LiveAgentSession>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What a Harness session shows about the team agent it runs, if any. */
export type TeamSessionBadge = {
  agentName: string;
  isOrchestrator: boolean;
  projectPath: string;
};

/**
 * The team agent a Harness session belongs to, while the board that
 * launched or resumed it keeps it registered. Never exposes the token.
 */
export function useTeamSession(sessionId: string): TeamSessionBadge | null {
  const read = () => sessionsById.get(sessionId);
  const session = useSyncExternalStore(subscribe, read, read);
  if (!session) return null;
  return {
    agentName: session.agentName,
    isOrchestrator: session.isOrchestrator,
    projectPath: session.projectPath,
  };
}

export function generateAgentToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function registerLiveAgent(session: LiveAgentSession): void {
  sessionsById.set(session.sessionId, session);
  sessionsByToken.set(session.agentToken, session);
  changed();
}

export function getLiveAgentBySessionId(
  sessionId: string,
): LiveAgentSession | undefined {
  return sessionsById.get(sessionId);
}

export function isLiveAgentSession(sessionId: string): boolean {
  return sessionsById.has(sessionId);
}

export function getLiveAgentByToken(
  token: string,
): LiveAgentSession | undefined {
  return sessionsByToken.get(token);
}

export function listLiveAgents(projectPath?: string): LiveAgentSession[] {
  const all = Array.from(sessionsById.values());
  if (!projectPath) return all;
  return all.filter((session) => session.projectPath === projectPath);
}

export function removeLiveAgent(sessionId: string): void {
  const session = sessionsById.get(sessionId);
  if (session) {
    sessionsByToken.delete(session.agentToken);
    sessionsById.delete(sessionId);
    changed();
  }
}

export async function registerLiveAgentWithControl(
  session: LiveAgentSession,
): Promise<boolean> {
  registerLiveAgent(session);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const ok = await invoke<boolean>("control_register_agent_token", {
      sessionId: session.sessionId,
      token: session.agentToken,
    });
    if (ok === false) {
      removeLiveAgent(session.sessionId);
      return false;
    }
    return true;
  } catch {
    removeLiveAgent(session.sessionId);
    return false;
  }
}

export async function revokeLiveAgent(sessionId: string): Promise<void> {
  removeLiveAgent(sessionId);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("control_revoke_agent_token", { sessionId });
  } catch {
    // In unit tests or non-Tauri environments, ignore invoke errors
  }
}

export function clearLiveAgentRegistry(): void {
  sessionsById.clear();
  sessionsByToken.clear();
}
