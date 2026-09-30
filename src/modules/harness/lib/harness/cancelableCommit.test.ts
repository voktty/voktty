import { describe, expect, it, vi } from "vitest";
import { generateCommitMessage } from "./textHarness";
import { registerHarness } from "./registry";

describe("cancelable commit message generation", () => {
  it("passes abort signal through generateCommitMessage to harness adapter", async () => {
    let receivedSignal: AbortSignal | undefined;
    registerHarness({
      id: "cursor",
      name: "Cursor",
      live: true,
      async sendTurn() {},
      async cancelTurn() {},
      async stopSession() {},
      async forgetSession() {},
      respondApproval() {},
      async generateCommitMessage(cwd, signal) {
        receivedSignal = signal;
        if (signal?.aborted) throw new Error("Aborted");
        return `feat: commit on ${cwd}`;
      },
    });

    const controller = new AbortController();
    const result = await generateCommitMessage("/path/to/repo", "cursor", controller.signal);
    expect(result).toBe("feat: commit on /path/to/repo");
    expect(receivedSignal).toBe(controller.signal);
  });

  it("aborts when signal is triggered before or during generation", async () => {
    registerHarness({
      id: "claude",
      name: "Claude",
      live: true,
      async sendTurn() {},
      async cancelTurn() {},
      async stopSession() {},
      async forgetSession() {},
      respondApproval() {},
      async generateCommitMessage(_cwd, signal) {
        signal?.throwIfAborted();
        return "feat: finished";
      },
    });

    const controller = new AbortController();
    controller.abort();

    await expect(
      generateCommitMessage("/path/to/repo", "claude", controller.signal),
    ).rejects.toThrow();
  });
});
