import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";
import type { MemoryTransport } from "@/modules/workspace-kit/lib/memoryTransport";
import {
  captureRemoteMemorySource,
  memoryFailure,
} from "@/modules/workspace-kit/lib/remoteMemorySource";
import {
  remoteMemoryError,
  remoteMemoryRequest,
  remoteMemoryResult,
} from "@/modules/workspace-kit/lib/remoteMemoryWire";
import { remoteSessions } from "@/modules/remote/sessionManager";
import {
  nextRemoteRequestId,
  REMOTE_PROTOCOL_VERSION,
  requestRemote,
} from "@/modules/remote/client";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";

let owners = 0;
const cleanupCommands = new Set([
  "project_memory_close",
  "project_memory_context_close",
]);
const openCommands = new Set([
  "project_memory_open",
  "project_memory_context_open",
]);

export function createRemoteMemoryTransport(
  target: MemoryPanelTarget,
): MemoryTransport {
  if (owners >= 256) memoryFailure("busy");
  const source = captureRemoteMemorySource(target);
  owners += 1;
  let references = 0;
  let opening: Promise<RemoteSessionLease> | null = null;
  let lease: RemoteSessionLease | null = null;
  let lost = false;
  let disposed = false;
  let requests = 0;
  const unsubscribe = remoteSessions.subscribe(() => {
    if (lease && !member()) lost = true;
  });
  function member() {
    return (
      lease !== null &&
      remoteSessions
        .snapshot()
        .some(
          (entry) =>
            entry.key.profileId === source.key.profileId &&
            entry.key.root === source.key.root &&
            entry.sessionId === lease?.info.session_id &&
            !entry.closing,
        )
    );
  }
  function checkSource() {
    if (lost || disposed) memoryFailure("cancelled");
    source.check();
    if (lease && !member()) {
      lost = true;
      memoryFailure("cancelled");
    }
  }
  async function acquire() {
    opening ??= remoteSessions
      .acquire(source.key, source.connection)
      .then((value) => {
        lease = value;
        return value;
      });
    return opening;
  }
  function owner(): MemoryTransport {
    references += 1;
    let retired = false;
    let released = false;
    let closing: Promise<void> | null = null;
    const pending = new Set<Promise<unknown>>();
    const check = () => {
      if (retired) memoryFailure("cancelled");
      checkSource();
    };
    return Object.freeze({
      check,
      retain() {
        check();
        if (references >= 256) memoryFailure("busy");
        return owner();
      },
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        if (retired) return Promise.reject({ code: "unavailable" });
        if (requests >= 256) return Promise.reject({ code: "busy" });
        requests += 1;
        const cleanup = cleanupCommands.has(command);
        const operation = Promise.resolve().then(async () => {
          if (!cleanup) check();
          const params = remoteMemoryRequest(source, command, args);
          if (
            new TextEncoder().encode(JSON.stringify(params)).length >
            512 * 1024
          )
            memoryFailure("limit");
          // Cleanup always addresses the original helper; it cannot reopen a session.
          const captured = cleanup ? lease : await acquire();
          if (!captured) memoryFailure("unavailable");
          if (!cleanup) check();
          if (!captured.info.capabilities.includes("memory.manage"))
            memoryFailure("unsupported");
          const id = nextRemoteRequestId();
          const response = await requestRemote(captured.info.session_id, {
            protocol: REMOTE_PROTOCOL_VERSION,
            id,
            method: "memory.manage",
            params,
          });
          if (
            response?.protocol !== REMOTE_PROTOCOL_VERSION ||
            response.id !== id ||
            typeof response.ok !== "boolean"
          )
            memoryFailure("unavailable");
          if (!response.ok) throw remoteMemoryError(response.error);
          if (
            new TextEncoder().encode(JSON.stringify(response.result) ?? "")
              .length >
            8 * 1024 * 1024
          )
            memoryFailure("limit");
          const result = remoteMemoryResult(source, response.result);
          // Keep late open handles addressable so the original client can close them.
          if (!cleanup && !openCommands.has(command)) check();
          return result as T;
        });
        pending.add(operation);
        const settled = () => {
          requests -= 1;
          pending.delete(operation);
        };
        void operation.then(settled, settled);
        return operation;
      },
      release() {
        if (released) return Promise.resolve();
        if (closing) return closing;
        retired = true;
        closing = Promise.resolve()
          .then(async () => {
            await Promise.allSettled([...pending]);
            if (references === 1) {
              if (opening) {
                try {
                  await opening;
                } catch {
                  // Failed acquisition created no lease owned by this transport.
                }
              }
              if (lease) {
                if (!lease.releaseAndClose) memoryFailure("unavailable");
                await lease.releaseAndClose();
              }
              disposed = true;
              unsubscribe();
              source.dispose();
              owners -= 1;
            }
            references -= 1;
            released = true;
          })
          .catch((error: unknown) => {
            closing = null;
            throw error;
          });
        return closing;
      },
    });
  }
  return owner();
}
