import { describe, expect, it } from "vitest";
import type { GitStagedContext } from "../fs";
import { registerHarness } from "./registry";
import { generateCommitMessage } from "./textHarness";

describe("cancelable commit message generation", () => {
  it("passes abort signal through generateCommitMessage to harness adapter", async () => {
    let receivedSignal: AbortSignal | undefined;
    let receivedContext: GitStagedContext | undefined;
    const context = {
      branch: "feature/session",
      summary: "Modified src/a.ts",
      patch: "diff --git a/src/a.ts b/src/a.ts",
    };
    registerHarness({
      id: "cursor",
      live: true,
      async sendTurn() {},
      async steerTurn() {},
      async cancelTurn() {},
      async stopSession() {},
      async forgetSession() {},
      bindSession() {},
      respondApproval() {},
      async generateCommitMessage(cwd, signal, received) {
        receivedSignal = signal;
        receivedContext = received;
        if (signal?.aborted) throw new Error("Aborted");
        return `feat: commit on ${cwd}`;
      },
    });

    const controller = new AbortController();
    const result = await generateCommitMessage(
      "/path/to/repo",
      "cursor",
      controller.signal,
      context,
    );
    expect(result).toBe("feat: commit on /path/to/repo");
    expect(receivedSignal).toBe(controller.signal);
    expect(receivedContext).toBe(context);
  });

  it("aborts when signal is triggered before or during generation", async () => {
    registerHarness({
      id: "claude",
      live: true,
      async sendTurn() {},
      async steerTurn() {},
      async cancelTurn() {},
      async stopSession() {},
      async forgetSession() {},
      bindSession() {},
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
