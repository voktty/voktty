import type { WorkspaceEnv } from "@/modules/workspace/env";
import {
  createNativeMemoryPresentation,
  type NativeMemoryScope,
  type NativeMemorySelection,
} from "@/modules/workspace-kit/lib/nativeMemory";

export type MemoryPanelTarget = Readonly<{
  path: string;
  environment: WorkspaceEnv;
  source: string;
}>;
export type MemoryPanelState =
  | { status: "loading" }
  | { status: "ready"; observation: NativeMemoryScope }
  | { status: "error"; code: string; canPrepare: boolean };
type Client = ReturnType<typeof createNativeMemoryPresentation>;
type Entry = {
  client: Client;
  retired: boolean;
  closing: Promise<boolean> | null;
};
const entries = new Set<Entry>();
const MAX_PANELS = 256;

function closeEntry(entry: Entry): Promise<boolean> {
  if (entry.closing) return entry.closing;
  entry.retired = true;
  entry.closing = Promise.resolve()
    .then(() => entry.client.close())
    .then(
      () => {
        entries.delete(entry);
        return true;
      },
      () => {
        entry.closing = null;
        return false;
      },
    );
  return entry.closing;
}

export function createMemoryPanelController(
  target: MemoryPanelTarget,
  publish: (state: MemoryPanelState) => void,
  createClient: () => Client = createNativeMemoryPresentation,
) {
  for (const entry of entries) if (entry.retired) void closeEntry(entry);
  if (entries.size >= MAX_PANELS)
    throw Object.assign(new Error("Project memory panels are busy"), {
      code: "busy",
    });
  const captured = structuredClone(target);
  const entry: Entry = {
    client: createClient(),
    retired: false,
    closing: null,
  };
  entries.add(entry);
  let selected: NativeMemorySelection | null = null;
  let pending: Promise<void> | null = null;
  const current = () =>
    !entry.retired && selected !== null && entry.client.isCurrent(selected);
  const notify = (state: MemoryPanelState) => {
    if (!entry.retired) publish(state);
  };
  function run(prepare: boolean) {
    if (entry.retired) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve()
      .then(async () => {
        if (entry.retired) return;
        notify({ status: "loading" });
        if (entry.retired) return;
        try {
          if (!selected)
            selected = await entry.client.select(
              captured.path,
              captured.environment,
            );
          const receipt = selected;
          if (!receipt || !current()) return;
          if (prepare) {
            await entry.client.initializeLocalState(receipt);
            if (!current()) return;
          }
          const observation = await entry.client.discover(receipt);
          if (!current()) return;
          notify({ status: "ready", observation });
        } catch (error) {
          if (entry.retired) return;
          const code =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
              ? error.code
              : "unavailable";
          notify({
            status: "error",
            code,
            canPrepare:
              current() && (code === "unavailable" || code === "missingState"),
          });
        }
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }
  return {
    load: () => run(false),
    prepare: () => run(true),
    dispose: () => closeEntry(entry),
  };
}

export function supportedMemoryPanelTarget(target: MemoryPanelTarget) {
  return (
    target.environment.kind === "local" &&
    !target.path.startsWith("remote://") &&
    target.path.length > 0 &&
    target.path.length <= 4096 &&
    !/[\x00-\x1f\x7f]/.test(target.path)
  );
}
