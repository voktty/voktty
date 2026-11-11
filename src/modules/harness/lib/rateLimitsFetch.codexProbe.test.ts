import { beforeEach, expect, it, vi } from "vitest";

type Exit = (code: number | null) => void;
type Line = (line: string) => void;

const child = vi.hoisted(() => ({
  exits: new Map<string, Exit>(),
  stderr: new Map<string, Line>(),
  spawns: [] as string[],
  // Per spawn: true makes that process die before it answers.
  dies: [] as boolean[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./fs", () => ({ homeDir: () => Promise.resolve("/home/u") }));
vi.mock("./harness/child", () => ({
  resolveCodexBinary: () => Promise.resolve({ path: "/bin/codex" }),
  killChild: () => Promise.resolve(),
  unwatchChild: () => {},
  watchChild: (id: string, _line: Line, exit: Exit, stderr?: Line) => {
    child.exits.set(id, exit);
    if (stderr) child.stderr.set(id, stderr);
  },
  spawnChild: (id: string) => {
    const dies = child.dies[child.spawns.length] ?? false;
    child.spawns.push(id);
    if (dies) {
      child.stderr.get(id)?.("Error: failed to load auth");
      child.exits.get(id)?.(1);
    }
    return Promise.resolve();
  },
}));
vi.mock("./harness/jsonRpc", () => ({
  JsonRpcClient: class {
    private failure: Error | null = null;
    pushLine() {}
    respond() {
      return Promise.resolve();
    }
    notify() {
      return Promise.resolve();
    }
    close(error?: Error) {
      if (error) this.failure = error;
    }
    request(method: string) {
      if (this.failure) return Promise.reject(this.failure);
      if (method === "initialize") return Promise.resolve({});
      return Promise.resolve({
        rateLimits: {
          primary: { usedPercent: 2, windowDurationMins: 300, resetsAt: 1 },
        },
      });
    }
  },
}));

import { codexProbeExitMessage, fetchCodexRateLimits } from "./rateLimitsFetch";

beforeEach(() => {
  child.exits.clear();
  child.stderr.clear();
  child.spawns.length = 0;
  child.dies = [];
});

it("says why the probe exited", () => {
  expect(codexProbeExitMessage(1, ["boom", "auth expired"])).toBe(
    "Codex usage probe exited (code 1): boom | auth expired",
  );
  expect(codexProbeExitMessage(null, [])).toBe("Codex usage probe exited");
});

it("reads usage again when the first probe dies before answering", async () => {
  child.dies = [true, false];
  const result = await fetchCodexRateLimits();
  expect(child.spawns).toHaveLength(2);
  expect(result.status).toBe("ok");
});

it("reports the exit code and stderr when the retry dies too", async () => {
  child.dies = [true, true];
  const result = await fetchCodexRateLimits();
  expect(child.spawns).toHaveLength(2);
  expect(result.status).toBe("error");
  expect(result.error).toBe(
    "Codex usage probe exited (code 1): Error: failed to load auth",
  );
});
