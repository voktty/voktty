import { describe, expect, it } from "vitest";
import type { GitRangeContext, GitStagedContext } from "../fs";
import { registerHarness } from "./registry";
import { generateCommitMessage, generatePrContent } from "./textHarness";

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

describe("PR content generation context", () => {
  it("passes native branch-range context to the selected Harness", async () => {
    let receivedContext: GitRangeContext | undefined;
    const context = {
      base: "main",
      head: "feature/session",
      commitSummary: "abcdef1 Improve session handling",
      diffSummary: "Modified src/session.ts",
      diffPatch: "diff --git a/src/session.ts b/src/session.ts",
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
      async generatePrContent(cwd, provided) {
        receivedContext = provided;
        return {
          title: `Update from ${cwd}`,
          body: "## Summary\n- Update",
          base: provided?.base ?? "",
          head: provided?.head ?? "",
        };
      },
    });

    const result = await generatePrContent(".", "cursor", context);

    expect(receivedContext).toBe(context);
    expect(result).toEqual({
      title: "Update from .",
      body: "## Summary\n- Update",
      base: "main",
      head: "feature/session",
    });
  });
});
