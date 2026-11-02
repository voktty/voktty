import {
  createNativeMemoryPresentation,
  type NativeMemoryScope,
  type NativeMemorySelection,
} from "@/modules/workspace-kit/lib/nativeMemory";
import {
  supportedMemoryPanelTarget,
  type MemoryPanelTarget,
} from "@/modules/workspace-kit/lib/memoryPanel";

export type MemoryIndicatorState =
  | "checking"
  | "found"
  | "absent"
  | "review"
  | "error"
  | "unsupported"
  | "noTarget";

export function memoryIndicatorState(
  observation: NativeMemoryScope,
): MemoryIndicatorState {
  if (
    observation?.schema !== 1 ||
    observation.scope?.schema !== 1 ||
    !Number.isSafeInteger(observation.blockedCount) ||
    observation.blockedCount < 0 ||
    typeof observation.scope.ancestryComplete !== "boolean"
  )
    return "error";
  if (observation.blockedCount > 0 || !observation.scope.ancestryComplete)
    return "review";
  if (observation.scope.state === "ready")
    return typeof observation.root === "string" &&
      observation.root.length > 0 &&
      observation.root.length <= 4096 &&
      !/[\x00-\x1f\x7f]/.test(observation.root)
      ? "found"
      : "error";
  if (
    observation.scope.state === "absent" ||
    observation.scope.state === "reserved"
  )
    return observation.root === null ? "absent" : "error";
  return "review";
}

type Client = Pick<
  ReturnType<typeof createNativeMemoryPresentation>,
  "select" | "inspect" | "isCurrent" | "close"
>;
type Entry = {
  closed: boolean;
  acknowledged: boolean;
  pending: Promise<void> | null;
  closing: Promise<void> | null;
  client: Client;
};
const entries = new Set<Entry>();
function collect(entry: Entry) {
  if (entry.closed && entry.acknowledged && !entry.pending)
    entries.delete(entry);
}
function close(entry: Entry): Promise<void> {
  entry.closed = true;
  entry.closing ??= Promise.resolve()
    .then(() => entry.client.close())
    .then(() => {
      entry.acknowledged = true;
      collect(entry);
    })
    .catch(() => {
      entry.closing = null;
    });
  return entry.closing;
}

export function createMemoryIndicator(
  target: MemoryPanelTarget,
  publish: (state: MemoryIndicatorState) => void,
  createClient: () => Client = createNativeMemoryPresentation,
) {
  if (!supportedMemoryPanelTarget(target))
    throw new Error("Unsupported memory indicator target");
  for (const entry of entries)
    if (entry.closed && !entry.acknowledged) void close(entry);
  if (entries.size >= 256) throw new Error("Memory indicators are busy");
  const captured = structuredClone(target);
  const entry: Entry = {
    closed: false,
    acknowledged: false,
    pending: null,
    closing: null,
    client: createClient(),
  };
  entries.add(entry);
  let selected: NativeMemorySelection | null = null;
  return {
    load() {
      if (entry.closed) return Promise.resolve();
      if (entry.pending) return entry.pending;
      entry.pending = Promise.resolve()
        .then(async () => {
          if (entry.closed) return;
          publish("checking");
          if (entry.closed) return;
          try {
            selected ??= await entry.client.select(
              captured.path,
              captured.environment,
            );
            if (entry.closed || !entry.client.isCurrent(selected)) return;
            const observation = await entry.client.inspect(selected);
            if (!entry.closed && entry.client.isCurrent(selected))
              publish(memoryIndicatorState(observation));
          } catch {
            if (!entry.closed) publish("error");
          }
        })
        .finally(() => {
          entry.pending = null;
          collect(entry);
        });
      return entry.pending;
    },
    dispose: () => close(entry),
  };
}
