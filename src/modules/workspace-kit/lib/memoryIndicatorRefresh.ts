const listeners = new Set<() => void>();

export function subscribeMemoryIndicatorRefresh(listener: () => void) {
  if (listeners.size >= 256)
    throw new Error("Memory indicator listeners are busy");
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function refreshMemoryIndicators() {
  for (const listener of [...listeners])
    if (listeners.has(listener)) listener();
}
