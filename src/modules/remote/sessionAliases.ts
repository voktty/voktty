/**
 * Replacement map for remote helper sessions that were lost and reopened.
 *
 * Spaces, tabs and leaves keep the numeric session id of the workspace they
 * connected with. When that helper dies, recovery opens a new session for the
 * same profile and root and records the replacement here, so every request
 * made through a stale copy reaches the live session instead of failing until
 * the user reconnects by hand. Only recovery of the exact same profile and
 * root records an alias, so a stale id can never be redirected to another host.
 */

const MAX_ALIASES = 256;
const MAX_HOPS = 16;
const aliases = new Map<number, number>();

export function liveRemoteSessionId(sessionId: number): number {
  let current = sessionId;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const next = aliases.get(current);
    if (next === undefined || next === current) return current;
    current = next;
  }
  return current;
}

export function recordRemoteSessionReplacement(
  lostId: number,
  replacementId: number,
): void {
  if (
    lostId === replacementId ||
    !Number.isSafeInteger(lostId) ||
    !Number.isSafeInteger(replacementId)
  )
    return;
  // A replacement can never point back into its own chain.
  if (liveRemoteSessionId(replacementId) === lostId) return;
  aliases.delete(lostId);
  aliases.set(lostId, replacementId);
  while (aliases.size > MAX_ALIASES) {
    const oldest = aliases.keys().next().value;
    if (oldest === undefined) break;
    aliases.delete(oldest);
  }
}

export function clearRemoteSessionAliases(): void {
  aliases.clear();
}
