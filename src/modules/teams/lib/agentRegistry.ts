import type { LiveAgentSession } from "../types";

const sessionsById = new Map<string, LiveAgentSession>();
const sessionsByToken = new Map<string, LiveAgentSession>();

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
}

export function getLiveAgentBySessionId(
  sessionId: string,
): LiveAgentSession | undefined {
  return sessionsById.get(sessionId);
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
  }
}

export function clearLiveAgentRegistry(): void {
  sessionsById.clear();
  sessionsByToken.clear();
}
