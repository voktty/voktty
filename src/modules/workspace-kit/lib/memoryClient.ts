import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";
import { createRemoteMemoryTransport } from "@/modules/workspace-kit/lib/remoteMemoryTransport";
import type { MemoryTransport } from "@/modules/workspace-kit/lib/memoryTransport";

export function createMemoryClient(target: MemoryPanelTarget) {
  const captured = structuredClone(target);
  let remote: MemoryTransport | null = null;
  let failure: unknown;
  const usesRemote =
    target.environment.kind === "ssh" || target.path.startsWith("remote://");
  if (usesRemote) {
    try {
      remote = createRemoteMemoryTransport(captured);
    } catch (error) {
      failure = error;
    }
  }
  const backend = () => {
    if (!remote) throw failure;
    return remote;
  };
  return createNativeMemoryPresentation(
    usesRemote
      ? {
          invoke: <T>(command: string, args?: Record<string, unknown>) =>
            Promise.resolve().then(() => backend().invoke<T>(command, args)),
          check: () => backend().check(),
          retain: () => backend().retain(),
          release: () => remote?.release() ?? Promise.resolve(),
        }
      : undefined,
  );
}
