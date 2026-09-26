import type { Session } from "./session";

/** Closed chats stay here so clicking a session card can paint without disk. */
export const SESSION_LOAD_CACHE_LIMIT = 48;

export function rememberLoadedSession(
  cache: Map<string, Session>,
  session: Session,
  limit = SESSION_LOAD_CACHE_LIMIT,
) {
  cache.delete(session.id);
  cache.set(session.id, session);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}
