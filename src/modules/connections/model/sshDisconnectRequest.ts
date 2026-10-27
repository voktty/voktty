const subscribers = new Set<{ disconnect: (profileId: string) => void }>();

export function subscribeSshDisconnectRequests(
  disconnect: (profileId: string) => void,
): () => void {
  if (subscribers.size >= 256)
    throw new Error("Too many SSH disconnect subscribers.");
  const entry = { disconnect };
  subscribers.add(entry);
  return () => {
    subscribers.delete(entry);
  };
}

export function requestSshDisconnect(profileId: string): void {
  if (
    typeof profileId !== "string" ||
    !profileId ||
    profileId.trim() !== profileId ||
    profileId.length > 256
  ) return;
  for (const entry of [...subscribers]) {
    if (subscribers.has(entry)) entry.disconnect(profileId);
  }
}
