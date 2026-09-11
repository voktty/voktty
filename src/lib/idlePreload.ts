export function scheduleIdle(callback: () => void, timeoutMs: number): void {
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: timeoutMs });
  } else {
    setTimeout(callback, Math.min(timeoutMs, 1000));
  }
}
