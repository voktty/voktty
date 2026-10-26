import type { WorkspaceEnv } from "@/modules/workspace";

export type FileToolName =
  | "grep"
  | "glob"
  | "read_file"
  | "list_directory"
  | "write_file"
  | "create_directory"
  | "edit"
  | "multi_edit";

export type ShellToolName = "bash_run" | "bash_background";
export type CapturedToolName = FileToolName | ShellToolName;

export type FileToolTarget = {
  directory: string;
  root: string;
  workspace: WorkspaceEnv;
  sessionId?: string | null;
  modelId?: string;
  planMode?: boolean;
};

type Call = {
  tool: CapturedToolName;
  input: string;
  target: FileToolTarget;
  charge: number;
  running: boolean;
  retired: boolean;
  onCollect: () => void;
  readers: number;
  approvalId?: string;
  retireGlobal: () => void;
  epoch: object;
  observers?: Set<() => void>;
};

type Budget = {
  count: number;
  characters: number;
  readers: number;
  retire: Set<() => void>;
  epoch: object;
};
const budgets = new WeakMap<object, Budget>();

const MAX_CALLS = 256;
const MAX_CHARACTERS = 8 * 1024 * 1024;
const MAX_INPUT_CHARACTERS = 1024 * 1024;

function encodeInput(input: unknown): string {
  let characters = 0;
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 20_000 || depth > 16)
      throw new Error("File tool input is too complex.");
    if (typeof value === "string") characters += value.length;
    else if (value !== null && typeof value === "object") {
      if (ancestors.has(value)) throw new Error("Invalid file tool input.");
      ancestors.add(value);
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
      } else {
        if (Object.getPrototypeOf(value) !== Object.prototype)
          throw new Error("Invalid file tool input.");
        for (const key of Object.keys(value)) {
          const field = (value as Record<string, unknown>)[key];
          if (field === undefined) continue;
          characters += key.length;
          visit(field, depth + 1);
        }
      }
      ancestors.delete(value);
    } else if (
      value !== null &&
      typeof value !== "boolean" &&
      !(typeof value === "number" && Number.isFinite(value))
    ) {
      throw new Error("Invalid file tool input.");
    }
    if (characters > MAX_INPUT_CHARACTERS)
      throw new Error("File tool input is too large.");
  };
  visit(input, 0);
  const encoded = JSON.stringify(input, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
  if (encoded.length > MAX_INPUT_CHARACTERS)
    throw new Error("File tool input is too large.");
  return encoded;
}

/** Runtime-only receipts; retaining a target never grants filesystem authority. */
export function createFileToolCalls(budget?: Budget) {
  const calls = new Map<string, Call>();
  const shared = budget ?? {
    count: 0,
    characters: 0,
    readers: 0,
    retire: new Set<() => void>(),
    epoch: {},
  };

  const ownerEpoch = shared.epoch;
  let retired = false;
  const ownerCurrent = () =>
    !budget || (!retired && shared.epoch === ownerEpoch);

  const collect = (id: string, call: Call) => {
    if (calls.get(id) !== call) return;
    calls.delete(id);
    shared.characters -= call.charge;
    shared.count--;
    shared.retire.delete(call.retireGlobal);
    call.onCollect();
  };
  const retire = (id: string, call: Call) => {
    if (calls.get(id) !== call) return;
    if (!call.retired) {
      call.retired = true;
      for (const observer of [...(call.observers ?? [])]) {
        try {
          observer();
        } catch {}
      }
    }
    if (!call.running && call.readers === 0) collect(id, call);
  };
  const match = (id: string, tool: CapturedToolName, input: unknown): Call => {
    const call = calls.get(id);
    if (
      !call ||
      !ownerCurrent() ||
      call.epoch !== shared.epoch ||
      call.retired ||
      call.tool !== tool ||
      call.input !== encodeInput(input)
    )
      throw new Error("The original file tool capture is unavailable.");
    return call;
  };

  const registry = {
    isCurrent: ownerCurrent,
    capture(
      id: string,
      tool: CapturedToolName,
      input: unknown,
      target: FileToolTarget,
      onCollect: () => void = () => {},
    ) {
      if (!ownerCurrent())
        throw new Error("The original file tool owner has retired.");
      if (!id || id.length > 1024 || calls.has(id))
        throw new Error("Invalid or duplicate file tool call.");
      if (shared.count >= MAX_CALLS)
        throw new Error("Too many unsettled file tool calls.");
      const encoded = encodeInput(input);
      const encodedTarget = encodeInput(target);
      const capturedTarget = structuredClone(target);
      const charge = encoded.length + encodedTarget.length + id.length;
      if (shared.characters + charge > MAX_CHARACTERS)
        throw new Error("File tool captures exceed the memory limit.");
      const call: Call = {
        tool,
        input: encoded,
        target: capturedTarget,
        charge,
        running: false,
        retired: false,
        onCollect,
        readers: 0,
        retireGlobal: () => retire(id, call),
        epoch: shared.epoch,
      };
      calls.set(id, call);
      shared.characters += charge;
      shared.count++;
      shared.retire.add(call.retireGlobal);
      return {
        retire: () => retire(id, call),
        bindApproval: (approvalId: string) => {
          if (
            calls.get(id) !== call ||
            call.retired ||
            call.epoch !== shared.epoch
          )
            return;
          if (
            !approvalId ||
            approvalId.length > 1024 ||
            (call.approvalId && call.approvalId !== approvalId)
          )
            throw new Error("The original file approval is unavailable.");
          if (!call.approvalId) {
            if (shared.characters + approvalId.length > MAX_CHARACTERS)
              throw new Error("File tool captures exceed the memory limit.");
            shared.characters += approvalId.length;
            call.charge += approvalId.length;
          }
          call.approvalId = approvalId;
        },
      };
    },
    preview(id: string, tool: FileToolName, input: unknown): FileToolTarget {
      return structuredClone(match(id, tool, input).target);
    },
    observe(
      id: string,
      tool: CapturedToolName,
      input: unknown,
      approvalId?: string,
      onRetire?: () => void,
    ) {
      const call = match(id, tool, input);
      if (approvalId !== undefined && call.approvalId !== approvalId)
        throw new Error("The original file approval is unavailable.");
      if (shared.readers >= MAX_CALLS)
        throw new Error("Too many unsettled file previews.");
      call.readers++;
      shared.readers++;
      if (onRetire) {
        call.observers ??= new Set();
        call.observers.add(onRetire);
      }
      let released = false;
      return {
        target: structuredClone(call.target),
        isCurrent: () =>
          calls.get(id) === call &&
          !call.retired &&
          call.epoch === shared.epoch,
        release: () => {
          if (released) return;
          released = true;
          if (onRetire) call.observers?.delete(onRetire);
          call.readers--;
          shared.readers--;
          if (call.retired && !call.running && call.readers === 0)
            collect(id, call);
        },
      };
    },
    claim(
      id: string,
      tool: CapturedToolName,
      input: unknown,
      approvalId?: string,
    ) {
      const call = match(id, tool, input);
      if (approvalId !== undefined && call.approvalId !== approvalId)
        throw new Error("The original file approval is unavailable.");
      if (call.running) throw new Error("File tool call is already running.");
      call.running = true;
      return {
        target: structuredClone(call.target),
        isCurrent: () =>
          calls.get(id) === call &&
          !call.retired &&
          call.epoch === shared.epoch,
        release: () => {
          call.running = false;
          retire(id, call);
        },
        retire: () => retire(id, call),
      };
    },
    retire(id: string): void {
      const call = calls.get(id);
      if (!call) return;
      retire(id, call);
    },
    retireApproval(id: string, approvalId: string): void {
      const call = calls.get(id);
      if (call?.approvalId === approvalId) retire(id, call);
    },
    retireApprovalId(approvalId: string): void {
      const captured = [...calls].filter(
        ([, call]) => call.approvalId === approvalId,
      );
      for (const [id, call] of captured) retire(id, call);
    },
    retireAll(): void {
      if (!budget) {
        shared.epoch = {};
        for (const retireCaptured of [...shared.retire]) retireCaptured();
      } else {
        retired = true;
        for (const [id, call] of calls) retire(id, call);
      }
    },
  };
  budgets.set(registry, shared);
  return registry;
}

export type FileToolCalls = ReturnType<typeof createFileToolCalls>;

const owners = new WeakMap<object, FileToolCalls>();

export function fileToolCallsFor(owner: object): FileToolCalls {
  let calls = owners.get(owner);
  if (!calls) {
    calls = createFileToolCalls();
    owners.set(owner, calls);
  }
  return calls;
}

export function inheritFileToolCalls(parent: object, child: object): void {
  if (owners.has(child)) throw new Error("File tool owner already exists.");
  const parentCalls = fileToolCallsFor(parent);
  if (!parentCalls.isCurrent())
    throw new Error("The original file tool owner has retired.");
  const budget = budgets.get(parentCalls);
  if (!budget) throw new Error("File tool budget is unavailable.");
  owners.set(child, createFileToolCalls(budget));
}
