import type { WorkspaceEnv } from "@/modules/workspace";

export type FileToolName =
  | "read_file"
  | "list_directory"
  | "write_file"
  | "create_directory"
  | "edit"
  | "multi_edit";

export type FileToolTarget = {
  directory: string;
  root: string;
  workspace: WorkspaceEnv;
};

type Call = {
  tool: FileToolName;
  input: string;
  target: FileToolTarget;
  charge: number;
  running: boolean;
  retired: boolean;
};

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
  const encoded = JSON.stringify(input);
  if (encoded.length > MAX_INPUT_CHARACTERS)
    throw new Error("File tool input is too large.");
  return encoded;
}

/** Runtime-only receipts; retaining a target never grants filesystem authority. */
export function createFileToolCalls() {
  const calls = new Map<string, Call>();
  let characters = 0;

  const collect = (id: string, call: Call) => {
    if (calls.get(id) !== call) return;
    calls.delete(id);
    characters -= call.charge;
  };
  const match = (id: string, tool: FileToolName, input: unknown): Call => {
    const call = calls.get(id);
    if (
      !call ||
      call.retired ||
      call.tool !== tool ||
      call.input !== encodeInput(input)
    )
      throw new Error("The original file tool capture is unavailable.");
    return call;
  };

  return {
    capture(
      id: string,
      tool: FileToolName,
      input: unknown,
      target: FileToolTarget,
    ): void {
      if (!id || id.length > 1024 || calls.has(id))
        throw new Error("Invalid or duplicate file tool call.");
      if (calls.size >= MAX_CALLS)
        throw new Error("Too many unsettled file tool calls.");
      const encoded = encodeInput(input);
      const encodedTarget = encodeInput(target);
      const capturedTarget = structuredClone(target);
      const charge = encoded.length + encodedTarget.length + id.length;
      if (characters + charge > MAX_CHARACTERS)
        throw new Error("File tool captures exceed the memory limit.");
      calls.set(id, {
        tool,
        input: encoded,
        target: capturedTarget,
        charge,
        running: false,
        retired: false,
      });
      characters += charge;
    },
    preview(id: string, tool: FileToolName, input: unknown): FileToolTarget {
      return structuredClone(match(id, tool, input).target);
    },
    claim(id: string, tool: FileToolName, input: unknown) {
      const call = match(id, tool, input);
      if (call.running) throw new Error("File tool call is already running.");
      call.running = true;
      return {
        target: structuredClone(call.target),
        isCurrent: () => calls.get(id) === call && !call.retired,
        release: () => collect(id, call),
      };
    },
    retire(id: string): void {
      const call = calls.get(id);
      if (!call) return;
      call.retired = true;
      if (!call.running) collect(id, call);
    },
    retireAll(): void {
      for (const [id, call] of calls) {
        call.retired = true;
        if (!call.running) collect(id, call);
      }
    },
  };
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
