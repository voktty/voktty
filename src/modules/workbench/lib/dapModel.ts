export type DapMessage = Record<string, unknown>;

export type DapThread = { id: number; name: string };
export type DapStackFrame = {
  id: number;
  name: string;
  line: number;
  column?: number;
  source?: { name?: string; path?: string };
};
export type DapScope = { name: string; variablesReference: number; expensive?: boolean };
export type DapVariable = {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
};

export type DapModel = {
  initialized: boolean;
  terminated: boolean;
  stoppedThreadId: number | null;
  stoppedReason: string | null;
  threads: DapThread[];
  stackFrames: DapStackFrame[];
  scopes: DapScope[];
  variables: DapVariable[];
  console: string;
};

const MAX_ITEMS = 1_000;
const MAX_CONSOLE = 256 * 1024;

export function createDapModel(): DapModel {
  return {
    initialized: false,
    terminated: false,
    stoppedThreadId: null,
    stoppedReason: null,
    threads: [],
    stackFrames: [],
    scopes: [],
    variables: [],
    console: "",
  };
}

function bodyOf(message: DapMessage): Record<string, unknown> {
  const body = message.body;
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
        )
        .slice(0, MAX_ITEMS)
    : [];
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(value: unknown, max = 8_192): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function findDapResponseError(
  messages: DapMessage[],
): { command: string; message: string } | null {
  for (const message of messages.slice(0, MAX_ITEMS)) {
    if (message.type !== "response" || message.success !== false) continue;
    return {
      command: text(message.command, 256) || "unknown",
      message: text(message.message, 8_192) || "Debug adapter request failed",
    };
  }
  return null;
}

export function reduceDapMessages(model: DapModel, messages: DapMessage[]): DapModel {
  const next = { ...model };
  for (const message of messages.slice(0, MAX_ITEMS)) {
    const body = bodyOf(message);
    if (message.type === "event") {
      if (message.event === "initialized") next.initialized = true;
      if (message.event === "stopped") {
        next.stoppedThreadId = finite(body.threadId) || null;
        next.stoppedReason = text(body.reason, 256) || null;
      }
      if (message.event === "continued") {
        next.stoppedThreadId = null;
        next.stoppedReason = null;
        next.stackFrames = [];
        next.scopes = [];
        next.variables = [];
      }
      if (message.event === "terminated" || message.event === "exited") {
        next.terminated = true;
      }
      if (message.event === "output") {
        next.console = `${next.console}${text(body.output, MAX_CONSOLE)}`.slice(-MAX_CONSOLE);
      }
      continue;
    }
    if (message.type !== "response" || message.success === false) continue;
    if (message.command === "threads") {
      next.threads = objectArray(body.threads).map((thread) => ({
        id: finite(thread.id),
        name: text(thread.name, 512),
      }));
    } else if (message.command === "stackTrace") {
      next.stackFrames = objectArray(body.stackFrames).map((frame) => ({
        id: finite(frame.id),
        name: text(frame.name, 1_024),
        line: finite(frame.line),
        column: finite(frame.column) || undefined,
        source:
          frame.source && typeof frame.source === "object" && !Array.isArray(frame.source)
            ? {
                name: text((frame.source as Record<string, unknown>).name, 1_024) || undefined,
                path: text((frame.source as Record<string, unknown>).path, 8_192) || undefined,
              }
            : undefined,
      }));
    } else if (message.command === "scopes") {
      next.scopes = objectArray(body.scopes).map((scope) => ({
        name: text(scope.name, 512),
        variablesReference: finite(scope.variablesReference),
        expensive: scope.expensive === true,
      }));
    } else if (message.command === "variables") {
      next.variables = objectArray(body.variables).map((variable) => ({
        name: text(variable.name, 1_024),
        value: text(variable.value, 8_192),
        type: text(variable.type, 512) || undefined,
        variablesReference: finite(variable.variablesReference),
      }));
    } else if (message.command === "evaluate") {
      const result = text(body.result, 16_384);
      if (result) next.console = `${next.console}> ${result}\n`.slice(-MAX_CONSOLE);
    }
  }
  return next;
}
