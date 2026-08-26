import { native } from "@/modules/ai/lib/native";
import { playVokttySound } from "@/modules/sound";
import { create } from "zustand";
import { discoverProjectTasks, type ProjectTask } from "./lib/taskDiscovery";
import { parseTestResults, type TestResult } from "./lib/testResults";

const MAX_OUTPUT = 1024 * 1024;
let pollPending = false;
let loadGeneration = 0;

function joinPath(root: string, relative: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relative.replace(/^[\\/]+/, "")}`;
}

async function readText(path: string): Promise<string | null> {
  try {
    const result = await native.readFile(path);
    return result.kind === "text" ? result.content : null;
  } catch {
    return null;
  }
}

export type TaskRun = {
  taskId: string;
  handle: number;
  startedAt: number;
  output: string;
  offset: number;
  dropped: number;
  exited: boolean;
  exitCode: number | null;
};

type TaskState = {
  root: string | null;
  scopeKey: string | null;
  tasks: ProjectTask[];
  loading: boolean;
  error: string | null;
  run: TaskRun | null;
  testResults: TestResult[];
  load: (root: string | null, scopeKey: string) => Promise<void>;
  start: (task: ProjectTask) => Promise<void>;
  poll: () => Promise<void>;
  stop: () => Promise<void>;
  clearOutput: () => void;
};

export const useTaskStore = create<TaskState>((set, get) => ({
  root: null,
  scopeKey: null,
  tasks: [],
  loading: false,
  error: null,
  run: null,
  testResults: [],

  load: async (root, scopeKey) => {
    const generation = ++loadGeneration;
    const previous = get();
    const workspaceChanged = previous.root !== root || previous.scopeKey !== scopeKey;
    if (workspaceChanged && previous.run && !previous.run.exited) {
      await native.shellBgKill(previous.run.handle).catch(() => {});
    }
    if (generation !== loadGeneration) return;
    if (!root) {
      set({
        root: null,
        scopeKey,
        tasks: [],
        run: workspaceChanged ? null : previous.run,
        testResults: workspaceChanged ? [] : previous.testResults,
        error: null,
        loading: false,
      });
      return;
    }
    set({
      root,
      scopeKey,
      run: workspaceChanged ? null : previous.run,
      testResults: workspaceChanged ? [] : previous.testResults,
      loading: true,
      error: null,
    });
    const [packageJson, cargoToml, customTasksJson] = await Promise.all([
      readText(joinPath(root, "package.json")),
      readText(joinPath(root, "Cargo.toml")),
      readText(joinPath(root, ".voktty/tasks.json")),
    ]);
    if (
      generation !== loadGeneration ||
      get().root !== root ||
      get().scopeKey !== scopeKey
    ) {
      return;
    }
    set({
      tasks: discoverProjectTasks({ packageJson, cargoToml, customTasksJson }),
      loading: false,
    });
  },

  start: async (task) => {
    const root = get().root;
    if (!root || get().run && !get().run?.exited) return;
    set({ error: null, testResults: [] });
    try {
      const handle = await native.shellBgSpawn(task.command, root);
      set({
        run: {
          taskId: task.id,
          handle,
          startedAt: Date.now(),
          output: "",
          offset: 0,
          dropped: 0,
          exited: false,
          exitCode: null,
        },
      });
      playVokttySound("start", { retrigger: "restart" });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      playVokttySound("error", { retrigger: "restart" });
    }
  },

  poll: async () => {
    const current = get().run;
    if (!current || current.exited || pollPending) return;
    pollPending = true;
    try {
      const response = await native.shellBgLogs(current.handle, current.offset);
      if (get().run?.handle !== current.handle) return;
      const output = `${current.output}${response.bytes}`.slice(-MAX_OUTPUT);
      set({
        run: {
          ...current,
          output,
          offset: response.next_offset,
          dropped: response.dropped,
          exited: response.exited,
          exitCode: response.exit_code,
        },
        testResults: parseTestResults(output),
      });
      if (response.exited && !current.exited) {
        playVokttySound(
          response.exit_code === 0 ? "complete" : "error",
          { retrigger: "restart" },
        );
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      pollPending = false;
    }
  },

  stop: async () => {
    const current = get().run;
    if (!current) return;
    const wasRunning = !current.exited;
    await native.shellBgKill(current.handle).catch(() => {});
    set({ run: { ...current, exited: true, exitCode: null } });
    if (wasRunning) playVokttySound("cancel", { retrigger: "restart" });
  },

  clearOutput: () => set({ run: null, testResults: [], error: null }),
}));
