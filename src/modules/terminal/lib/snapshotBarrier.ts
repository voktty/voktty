const SNAPSHOT_BARRIER_PREFIX = "\0VOKTTY_COLLAB_SNAPSHOT:";
const SNAPSHOT_BARRIER_TIMEOUT_MS = 5_000;

type PendingBarrier = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingBarriers = new Map<string, PendingBarrier>();
const decoder = new TextDecoder();
const prefixBytes = new TextEncoder().encode(SNAPSHOT_BARRIER_PREFIX);

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let handlers:
    | { resolve: () => void; reject: (error: Error) => void }
    | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    handlers = { resolve, reject };
  });
  if (!handlers) throw new Error("collab_snapshot_deferred_failed");
  return { promise, ...handlers };
}

function barrierKey(leafId: number, token: string): string {
  return `${leafId}:${token}`;
}

export function createSnapshotBarrierToken(): string {
  return crypto.randomUUID();
}

export function registerSnapshotBarrier(
  leafId: number,
  token: string,
  timeoutMs = SNAPSHOT_BARRIER_TIMEOUT_MS,
): { reached: Promise<void>; cancel: () => void } {
  const key = barrierKey(leafId, token);
  const { promise: reached, resolve, reject } = createDeferred();
  const pending: PendingBarrier = {
    resolve,
    reject,
    timer: setTimeout(() => {
      pendingBarriers.delete(key);
      reject(new Error("collab_snapshot_barrier_timeout"));
    }, timeoutMs),
  };
  pendingBarriers.set(key, pending);
  return {
    reached,
    cancel: () => {
      const current = pendingBarriers.get(key);
      if (!current) return;
      clearTimeout(current.timer);
      pendingBarriers.delete(key);
      current.resolve();
    },
  };
}

export function consumeSnapshotBarrier(
  leafId: number,
  bytes: Uint8Array,
): boolean {
  if (bytes.byteLength <= prefixBytes.byteLength) return false;
  for (let index = 0; index < prefixBytes.byteLength; index += 1) {
    if (bytes[index] !== prefixBytes[index]) return false;
  }
  const token = decoder.decode(bytes.subarray(prefixBytes.byteLength));
  const key = barrierKey(leafId, token);
  const pending = pendingBarriers.get(key);
  if (!pending) return true;
  clearTimeout(pending.timer);
  pendingBarriers.delete(key);
  pending.resolve();
  return true;
}
