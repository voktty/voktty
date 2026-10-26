import { create } from "zustand";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { nativeOperationAdapter } from "../lib/nativeOperationAdapter";
import {
  applyOperation,
  revertOperation,
  validateOperationEntries,
  type AppliedOperation,
  type OperationEntry,
  type OperationResult,
} from "../lib/operationTransaction";

export type QueuedEdit = OperationEntry & {
  sessionId: string | null;
  modelId: string;
  createdAt: number;
};

export type CommandProvenance = {
  kind: "format" | "types" | "tests";
  command: string;
  exitCode: number | null;
  cancelled: boolean;
  timedOut: boolean;
  ranAt: number;
};

export type DevelopmentOperation = {
  id: string;
  transaction: AppliedOperation;
  status: "applied" | "reverted";
  sessionId: string | null;
  modelId: string;
  files: string[];
  commands: CommandProvenance[];
  createdAt: number;
  revertedAt: number | null;
};

type EnqueueResult = { ok: true } | { ok: false; error: string };

type PlanState = {
  active: boolean;
  queue: QueuedEdit[];
  lastOperation: DevelopmentOperation | null;
  lastError: string | null;
  pendingCommands: CommandProvenance[];
  pendingOperation: "apply" | "revert" | null;
  toggle: () => void;
  enable: () => void;
  disable: () => void;
  enqueue: (edit: QueuedEdit) => EnqueueResult;
  removeOne: (id: string) => void;
  clear: () => void;
  applyAll: () => Promise<OperationResult>;
  revertLast: () => Promise<OperationResult>;
  dismissLast: () => void;
  recordCommand: (command: CommandProvenance) => void;
};

let nextId = 1;
type PlanReceipt = { kind: "apply" | "revert"; entries: Set<QueuedEdit> };
let pending: PlanReceipt | null = null;

function retainedEntries(queue: QueuedEdit[]): QueuedEdit[] {
  return queue.filter((entry) => pending?.entries.has(entry));
}
export function newQueuedEditId(): string {
  return `q-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
}

function operationId(): string {
  return `op-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
}

function operationEntries(queue: readonly QueuedEdit[]): OperationEntry[] {
  return queue.map(
    ({
      sessionId: _sessionId,
      modelId: _modelId,
      createdAt: _createdAt,
      ...entry
    }) => entry,
  );
}

export const usePlanStore = create<PlanState>((set, get) => ({
  active: false,
  queue: [],
  lastOperation: null,
  lastError: null,
  pendingCommands: [],
  pendingOperation: null,
  toggle: () =>
    set((state) => ({
      active: !state.active,
      queue: state.active ? retainedEntries(state.queue) : state.queue,
      lastError: null,
    })),
  enable: () => set({ active: true, lastError: null }),
  disable: () =>
    set((state) => ({
      active: false,
      queue: retainedEntries(state.queue),
      lastError: null,
    })),
  enqueue: (edit) => {
    const captured = {
      ...edit,
      workspaceEnv: structuredClone(edit.workspaceEnv ?? currentWorkspaceEnv()),
    };
    const queue = [...get().queue, captured];
    const error = validateOperationEntries(operationEntries(queue));
    if (error) {
      set({ lastError: error });
      return { ok: false, error };
    }
    set({ queue, lastError: null });
    return { ok: true };
  },
  removeOne: (id) =>
    set((state) => ({
      queue: state.queue.filter(
        (edit) => edit.id !== id || pending?.entries.has(edit),
      ),
      lastError: null,
    })),
  clear: () =>
    set((state) => ({ queue: retainedEntries(state.queue), lastError: null })),
  async applyAll() {
    if (pending)
      return { ok: false, error: "another plan operation is running" };
    const queue = get().queue;
    const commands = get().pendingCommands;
    const capturedCommands = new Set(commands);
    const receipt: PlanReceipt = { kind: "apply", entries: new Set(queue) };
    pending = receipt;
    try {
      set({ pendingOperation: "apply", lastError: null });
      const result = await applyOperation(
        operationEntries(queue),
        nativeOperationAdapter,
      );
      if (!result.ok) {
        set({ lastError: result.error });
        return result;
      }
      const sessionIds = new Set(queue.map((edit) => edit.sessionId));
      const modelIds = new Set(queue.map((edit) => edit.modelId));
      const lastOperation: DevelopmentOperation = {
        id: operationId(),
        transaction: result.operation,
        status: "applied",
        sessionId: sessionIds.size === 1 ? (queue[0]?.sessionId ?? null) : null,
        modelId:
          modelIds.size === 1 ? (queue[0]?.modelId ?? "unknown") : "mixed",
        files: [...new Set(queue.map((edit) => edit.path))],
        commands,
        createdAt: Math.min(...queue.map((edit) => edit.createdAt)),
        revertedAt: null,
      };
      set((state) => ({
        queue: state.queue.filter((entry) => !receipt.entries.has(entry)),
        pendingCommands: state.pendingCommands.filter(
          (command) => !capturedCommands.has(command),
        ),
        lastOperation,
        lastError: null,
      }));
      return result;
    } finally {
      if (pending === receipt) {
        pending = null;
        set({ pendingOperation: null });
      }
    }
  },
  async revertLast() {
    if (pending)
      return { ok: false, error: "another plan operation is running" };
    const current = get().lastOperation;
    if (current?.status !== "applied") {
      return { ok: false, error: "there is no applied operation to revert" };
    }
    const receipt: PlanReceipt = { kind: "revert", entries: new Set() };
    pending = receipt;
    try {
      set({ pendingOperation: "revert", lastError: null });
      const result = await revertOperation(
        current.transaction,
        nativeOperationAdapter,
      );
      if (!result.ok) {
        set({ lastError: result.error });
        return result;
      }
      set((state) =>
        state.lastOperation?.transaction === current.transaction
          ? {
              lastOperation: {
                ...state.lastOperation,
                status: "reverted",
                revertedAt: Date.now(),
              },
              lastError: null,
            }
          : {},
      );
      return result;
    } finally {
      if (pending === receipt) {
        pending = null;
        set({ pendingOperation: null });
      }
    }
  },
  dismissLast: () => {
    if (pending?.kind !== "revert")
      set({ lastOperation: null, lastError: null });
  },
  recordCommand: (command) =>
    set((state) =>
      state.lastOperation?.status === "applied"
        ? {
            lastOperation: {
              ...state.lastOperation,
              commands: [...state.lastOperation.commands, command],
            },
          }
        : { pendingCommands: [...state.pendingCommands, command] },
    ),
}));
