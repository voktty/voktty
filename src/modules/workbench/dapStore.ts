import { native } from "@/modules/ai/lib/native";
import { playVokttySound } from "@/modules/sound";
import { create } from "zustand";
import {
  createDapModel,
  findDapResponseError,
  type DapMessage,
  type DapModel,
  reduceDapMessages,
} from "./lib/dapModel";

export type DapBreakpoint = { path: string; line: number };
export type DapLaunchConfig = {
  adapterCommand: string;
  request: "launch" | "attach";
  arguments: Record<string, unknown>;
};

type DapStatus = "idle" | "starting" | "running" | "stopped" | "terminated" | "error";

type DapState = {
  sessionId: number | null;
  root: string | null;
  scopeKey: string | null;
  status: DapStatus;
  error: string | null;
  model: DapModel;
  breakpoints: DapBreakpoint[];
  start: (root: string, scopeKey: string, config: DapLaunchConfig) => Promise<void>;
  syncWorkspace: (root: string | null, scopeKey: string) => Promise<void>;
  poll: () => Promise<void>;
  stop: () => Promise<void>;
  control: (command: "continue" | "pause" | "next" | "stepIn" | "stepOut") => Promise<void>;
  addBreakpoint: (path: string, line: number) => Promise<void>;
  removeBreakpoint: (path: string, line: number) => Promise<void>;
  selectFrame: (frameId: number) => Promise<void>;
  loadVariables: (variablesReference: number) => Promise<void>;
  evaluate: (expression: string) => Promise<void>;
};

let requestSequence = 1;
let launchConfig: DapLaunchConfig | null = null;
let pollPending = false;

async function request(
  sessionId: number,
  command: string,
  args: Record<string, unknown> = {},
): Promise<void> {
  await native.dapSend(sessionId, {
    seq: requestSequence++,
    type: "request",
    command,
    arguments: args,
  });
}

function groupBreakpoints(breakpoints: DapBreakpoint[]) {
  const groups = new Map<string, number[]>();
  for (const breakpoint of breakpoints) {
    const lines = groups.get(breakpoint.path) ?? [];
    lines.push(breakpoint.line);
    groups.set(breakpoint.path, lines);
  }
  return groups;
}

async function syncBreakpoints(sessionId: number, breakpoints: DapBreakpoint[]) {
  for (const [path, lines] of groupBreakpoints(breakpoints)) {
    await request(sessionId, "setBreakpoints", {
      source: { path },
      breakpoints: lines.slice(0, 1_000).map((line) => ({ line })),
      sourceModified: false,
    });
  }
}

export const useDapStore = create<DapState>((set, get) => ({
  sessionId: null,
  root: null,
  scopeKey: null,
  status: "idle",
  error: null,
  model: createDapModel(),
  breakpoints: [],

  start: async (root, scopeKey, config) => {
    if (get().sessionId !== null) await get().stop();
    set({ root, scopeKey, status: "starting", error: null, model: createDapModel() });
    requestSequence = 1;
    launchConfig = config;
    let startedSessionId: number | null = null;
    try {
      const sessionId = await native.dapStart(config.adapterCommand, root);
      startedSessionId = sessionId;
      set({ sessionId });
      playVokttySound("start", { retrigger: "restart" });
      await request(sessionId, "initialize", {
        clientID: "voktty",
        clientName: "Voktty",
        adapterID: "voktty.custom",
        pathFormat: "path",
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        supportsRunInTerminalRequest: false,
      });
    } catch (error) {
      if (startedSessionId !== null) {
        await native.dapStop(startedSessionId).catch(() => {});
      }
      launchConfig = null;
      set({
        sessionId: null,
        root: null,
        scopeKey: null,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      playVokttySound("error", { retrigger: "restart" });
    }
  },

  syncWorkspace: async (root, scopeKey) => {
    const current = get();
    if (
      current.sessionId !== null &&
      (current.root !== root || current.scopeKey !== scopeKey)
    ) {
      await current.stop();
    }
  },

  poll: async () => {
    const sessionId = get().sessionId;
    if (sessionId === null || pollPending) return;
    pollPending = true;
    try {
      const response = await native.dapPoll(sessionId);
      if (get().sessionId !== sessionId) return;
      const messages = response.messages as DapMessage[];
      const previous = get().model;
      const previousStatus = get().status;
      const model = reduceDapMessages(previous, messages);
      if (response.stderr) model.console = `${model.console}${response.stderr}`.slice(-(256 * 1024));
      const adapterFailure = findDapResponseError(messages);
      const error = response.error ?? adapterFailure?.message ?? get().error;
      let status: DapStatus = get().status;
      if (model.terminated || response.exited) status = "terminated";
      else if (model.stoppedThreadId !== null) status = "stopped";
      else if (model.initialized) status = "running";
      if (
        adapterFailure &&
        ["initialize", "launch", "attach"].includes(adapterFailure.command)
      ) {
        status = "error";
      }
      set({ model, status, error });
      if (status !== previousStatus) {
        if (status === "error") {
          playVokttySound("error", { retrigger: "restart" });
        } else if (status === "terminated") {
          playVokttySound("complete", { retrigger: "restart" });
        }
      }

      for (const message of messages) {
        if (message.type === "response" && message.command === "initialize" && message.success !== false) {
          if (launchConfig) await request(sessionId, launchConfig.request, launchConfig.arguments);
        }
        if (message.type === "event" && message.event === "initialized") {
          await syncBreakpoints(sessionId, get().breakpoints);
          await request(sessionId, "configurationDone");
        }
        if (message.type === "event" && message.event === "stopped") {
          await request(sessionId, "threads");
        }
        if (message.type === "response" && message.command === "threads") {
          const threadId = model.stoppedThreadId ?? model.threads[0]?.id;
          if (threadId) await request(sessionId, "stackTrace", { threadId, startFrame: 0, levels: 200 });
        }
        if (message.type === "response" && message.command === "stackTrace") {
          const frameId = model.stackFrames[0]?.id;
          if (frameId) await request(sessionId, "scopes", { frameId });
        }
        if (message.type === "response" && message.command === "scopes") {
          const reference = model.scopes.find((scope) => !scope.expensive)?.variablesReference;
          if (reference) await request(sessionId, "variables", { variablesReference: reference });
        }
      }
    } catch (error) {
      set({ status: "error", error: error instanceof Error ? error.message : String(error) });
    } finally {
      pollPending = false;
    }
  },

  stop: async () => {
    const sessionId = get().sessionId;
    if (sessionId !== null) {
      playVokttySound("cancel", { retrigger: "restart" });
    }
    if (sessionId !== null) {
      await request(sessionId, "disconnect", { terminateDebuggee: true }).catch(() => {});
      await native.dapStop(sessionId).catch(() => {});
    }
    launchConfig = null;
    set({
      sessionId: null,
      root: null,
      scopeKey: null,
      status: "idle",
      model: createDapModel(),
      error: null,
    });
  },

  control: async (command) => {
    const { sessionId, model } = get();
    if (sessionId === null) return;
    const threadId = model.stoppedThreadId ?? model.threads[0]?.id;
    await request(sessionId, command, threadId ? { threadId } : {});
    if (command !== "pause") set({ status: "running" });
  },

  addBreakpoint: async (path, line) => {
    if (!path.trim() || !Number.isInteger(line) || line < 1) return;
    const breakpoints = [...get().breakpoints.filter((item) => !(item.path === path && item.line === line)), { path, line }].slice(-1_000);
    set({ breakpoints });
    const sessionId = get().sessionId;
    if (sessionId !== null) await syncBreakpoints(sessionId, breakpoints.filter((item) => item.path === path));
  },

  removeBreakpoint: async (path, line) => {
    const breakpoints = get().breakpoints.filter((item) => !(item.path === path && item.line === line));
    set({ breakpoints });
    const sessionId = get().sessionId;
    if (sessionId !== null) {
      await request(sessionId, "setBreakpoints", {
        source: { path },
        breakpoints: breakpoints.filter((item) => item.path === path).map((item) => ({ line: item.line })),
      });
    }
  },

  selectFrame: async (frameId) => {
    const sessionId = get().sessionId;
    if (sessionId !== null) await request(sessionId, "scopes", { frameId });
  },

  loadVariables: async (variablesReference) => {
    const sessionId = get().sessionId;
    if (sessionId !== null && variablesReference > 0) {
      await request(sessionId, "variables", { variablesReference });
    }
  },

  evaluate: async (expression) => {
    const sessionId = get().sessionId;
    if (sessionId === null || !expression.trim()) return;
    await request(sessionId, "evaluate", {
      expression: expression.slice(0, 16_384),
      frameId: get().model.stackFrames[0]?.id,
      context: "repl",
    });
  },
}));
