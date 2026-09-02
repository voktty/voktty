import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CheckpointStatus,
  HarnessProbeResult,
  HarnessSession,
  HarnessSessionSummary,
  ModelContextWindow,
} from "./types";

export type HarnessStdoutPayload = {
  sessionId: string;
  line: string;
};

export type HarnessStderrPayload = {
  sessionId: string;
  line: string;
};

export type HarnessExitPayload = {
  sessionId: string;
  code?: number | null;
  error?: string | null;
};

export const harnessClient = {
  async spawn(
    sessionId: string,
    cwd: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<number> {
    return invoke<number>("harness_spawn", {
      sessionId,
      cwd,
      command,
      args,
      env: env || null,
    });
  },

  async stdin(sessionId: string, input: string): Promise<void> {
    return invoke<void>("harness_stdin", { sessionId, input });
  },

  async kill(sessionId: string): Promise<boolean> {
    return invoke<boolean>("harness_kill", { sessionId });
  },

  async killAll(): Promise<number> {
    return invoke<number>("harness_kill_all");
  },

  async probeAvailability(): Promise<HarnessProbeResult[]> {
    return invoke<HarnessProbeResult[]>("harness_probe_availability");
  },

  async initCheckpoint(sessionId: string, cwd: string): Promise<void> {
    return invoke<void>("harness_checkpoint_init", { sessionId, cwd });
  },

  async captureCheckpoint(
    sessionId: string,
    cwd: string,
    paths: string[],
  ): Promise<void> {
    return invoke<void>("harness_checkpoint_capture", { sessionId, cwd, paths });
  },

  async getCheckpointStatus(
    sessionId: string,
    cwd: string,
  ): Promise<CheckpointStatus> {
    return invoke<CheckpointStatus>("harness_checkpoint_status", {
      sessionId,
      cwd,
    });
  },

  async undoCheckpoint(sessionId: string, cwd: string): Promise<number> {
    return invoke<number>("harness_checkpoint_undo", { sessionId, cwd });
  },

  async keepCheckpoint(sessionId: string): Promise<void> {
    return invoke<void>("harness_checkpoint_keep", { sessionId });
  },

  async upsertSession(session: HarnessSession): Promise<void> {
    return invoke<void>("harness_session_upsert", { session });
  },

  async getSession(id: string): Promise<HarnessSession | null> {
    return invoke<HarnessSession | null>("harness_session_get", { id });
  },

  async listSessions(
    cwd?: string,
    limit?: number,
  ): Promise<HarnessSessionSummary[]> {
    return invoke<HarnessSessionSummary[]>("harness_session_list", {
      cwd: cwd || null,
      limit: limit || null,
    });
  },

  async deleteSession(id: string): Promise<boolean> {
    return invoke<boolean>("harness_session_delete", { id });
  },

  async searchSessions(
    query: string,
    cwd?: string,
    limit?: number,
  ): Promise<HarnessSessionSummary[]> {
    return invoke<HarnessSessionSummary[]>("harness_session_search", {
      query,
      cwd: cwd || null,
      limit: limit || null,
    });
  },

  async getModelContextWindow(model: string): Promise<ModelContextWindow> {
    return invoke<ModelContextWindow>("harness_model_context_window", { model });
  },

  onStdout(callback: (payload: HarnessStdoutPayload) => void): Promise<UnlistenFn> {
    return listen<HarnessStdoutPayload>("harness:stdout", (event) => {
      callback(event.payload);
    });
  },

  onStderr(callback: (payload: HarnessStderrPayload) => void): Promise<UnlistenFn> {
    return listen<HarnessStderrPayload>("harness:stderr", (event) => {
      callback(event.payload);
    });
  },

  onExit(callback: (payload: HarnessExitPayload) => void): Promise<UnlistenFn> {
    return listen<HarnessExitPayload>("harness:exit", (event) => {
      callback(event.payload);
    });
  },
};
