import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceEnv } from "@/modules/workspace/env";
import type { MemoryScope } from "@/modules/workspace-kit/lib/scope";

type Handle = Readonly<{ id: number; token: string }>;
const selectionBrand = Symbol("native-memory-selection");
export type NativeMemorySelection = Readonly<{
  [selectionBrand]: true;
}>;
export type NativeMemoryScope = Readonly<{
  schema: 1;
  scope: MemoryScope;
  root: string | null;
  blockedCount: number;
}>;

function cancelled(): never {
  throw Object.assign(new Error("Native memory presentation was retired"), {
    code: "cancelled",
  });
}

export function createNativeMemoryPresentation() {
  let closed = false;
  let revision = 0;
  let opening: Promise<Handle> | null = null;
  let closing: Promise<void> | null = null;
  let current: {
    receipt: NativeMemorySelection;
    token: string;
  } | null = null;

  function handle() {
    if (closed) cancelled();
    opening ??= Promise.resolve().then(() =>
      invoke<Handle>("project_memory_open"),
    );
    return opening;
  }

  function capture(receipt: NativeMemorySelection) {
    if (closed || !current || current.receipt !== receipt) cancelled();
    return current;
  }

  async function request<T>(command: string, receipt: NativeMemorySelection) {
    const selected = capture(receipt);
    const owner = await handle();
    capture(receipt);
    try {
      const result = await invoke<T>(command, {
        handle: owner,
        selection: selected.token,
      });
      capture(receipt);
      return result;
    } catch (error) {
      capture(receipt);
      throw error;
    }
  }

  return {
    async select(path: string, environment: WorkspaceEnv) {
      if (closed) cancelled();
      current = null;
      const requested = ++revision;
      if (!Number.isSafeInteger(requested)) cancelled();
      const captured = structuredClone(environment);
      const nativeEnvironment =
        captured.kind === "docker"
          ? { ...captured.connection, kind: "docker" }
          : captured;
      const check = () => {
        if (closed || revision !== requested) cancelled();
      };
      try {
        const owner = await handle();
        check();
        const token = await invoke<string>("project_memory_select", {
          handle: owner,
          path,
          environment: nativeEnvironment,
          revision: requested,
        });
        check();
        const receipt = Object.freeze({ [selectionBrand]: true as const });
        current = { receipt, token };
        return receipt;
      } catch (error) {
        check();
        throw error;
      }
    },
    discover(receipt: NativeMemorySelection) {
      return request<NativeMemoryScope>("project_memory_discover", receipt);
    },
    initializeLocalState(receipt: NativeMemorySelection) {
      return request<void>("project_memory_initialize_local_state", receipt);
    },
    isCurrent(receipt: NativeMemorySelection) {
      return !closed && current?.receipt === receipt;
    },
    close() {
      if (closing) return closing;
      closed = true;
      current = null;
      closing = (async () => {
        if (!opening) return;
        let owner: Handle;
        try {
          owner = await opening;
        } catch {
          return;
        }
        await invoke<void>("project_memory_close", { handle: owner });
      })().catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "cancelled"
        )
          return;
        closing = null;
        throw error;
      });
      return closing;
    },
  };
}
