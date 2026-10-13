let currentLease: symbol | null = null;

export function registerEmbeddedChat(): () => void {
  const lease = Symbol("embedded-chat");
  currentLease = lease;
  return () => {
    if (currentLease === lease) currentLease = null;
  };
}

export function hasEmbeddedChat(): boolean {
  return currentLease !== null;
}
