import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnChild: vi.fn(),
  killChild: vi.fn(),
  watchChild: vi.fn(),
  unwatchChild: vi.fn(),
}));

vi.mock("./child", () => ({
  killChild: mocks.killChild,
  resolveHermesBinary: vi.fn().mockResolvedValue({ path: "/usr/local/bin/hermes" }),
  spawnChild: mocks.spawnChild,
  unwatchChild: mocks.unwatchChild,
  watchChild: mocks.watchChild,
}));

import {
  __hermesTestReset,
  buildHermesSpawnArgs,
  sendHermesTurn,
  setHermesBinaryResolver,
} from "./hermes";
import type { HarnessEvent } from "./types";

describe("buildHermesSpawnArgs", () => {
  it("builds basic run args with prompt", () => {
    const args = buildHermesSpawnArgs({ text: "hello hermes", model: "" });
    expect(args).toEqual(["run", "-p", "hello hermes"]);
  });

  it("adds model flag when model is specified", () => {
    const args = buildHermesSpawnArgs({
      text: "hello",
      model: "hermes-3-llama-3.1-405b",
    });
    expect(args).toEqual([
      "run",
      "-p",
      "hello",
      "--model",
      "hermes-3-llama-3.1-405b",
    ]);
  });

  it("appends attachment paths to prompt", () => {
    const args = buildHermesSpawnArgs({
      text: "check this",
      model: "",
      attachments: [
        {
          id: "a1",
          name: "test.ts",
          mimeType: "text/plain",
          kind: "file",
          size: 100,
          path: "/workspace/test.ts",
        },
      ],
    });
    expect(args[2]).toContain("check this");
    expect(args[2]).toContain("Attached files:");
    expect(args[2]).toContain("- /workspace/test.ts");
  });
});

describe("sendHermesTurn", () => {
  beforeEach(() => {
    __hermesTestReset();
    mocks.spawnChild.mockReset().mockResolvedValue(undefined);
    mocks.killChild.mockReset().mockResolvedValue(undefined);
    mocks.watchChild.mockReset();
    mocks.unwatchChild.mockReset();
    setHermesBinaryResolver(async () => ({ path: "/mock/hermes" }));
  });

  it("spawns child process and emits session.started", async () => {
    const events: HarnessEvent[] = [];
    await sendHermesTurn({
      sessionId: "s1",
      text: "hi",
      model: "",
      cwd: "/workspace",
      runtimeMode: "supervised",
      modelSettings: {},
      networkAllowlist: [],
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([{ type: "session.started" }]);
    expect(mocks.spawnChild).toHaveBeenCalledWith(
      "s1",
      "/mock/hermes",
      ["run", "-p", "hi"],
      "/workspace",
      [],
    );
    expect(mocks.watchChild).toHaveBeenCalledWith(
      "s1",
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("parses reasoning tags and message deltas from child stdout", async () => {
    const events: HarnessEvent[] = [];
    let stdoutCb: (line: string) => void = () => {};
    let exitCb: (code: number | null) => void = () => {};

    mocks.watchChild.mockImplementation((_id, onStdout, onExit) => {
      stdoutCb = onStdout;
      exitCb = onExit;
    });

    await sendHermesTurn({
      sessionId: "s1",
      text: "hi",
      model: "",
      cwd: "/workspace",
      runtimeMode: "supervised",
      modelSettings: {},
      networkAllowlist: [],
      onEvent: (event) => events.push(event),
    });

    stdoutCb("<think>thinking about the problem");
    stdoutCb("more thoughts</think>");
    stdoutCb("Here is the answer");
    exitCb(0);

    expect(events).toEqual([
      { type: "session.started" },
      { type: "reasoning.delta", text: "thinking about the problem\n" },
      { type: "reasoning.delta", text: "more thoughts\n" },
      { type: "reasoning.completed" },
      { type: "message.delta", text: "Here is the answer\n" },
      { type: "message.completed" },
      { type: "session.ended", code: 0 },
    ]);
  });
});
