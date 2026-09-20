import {
  createHarnessModel,
  HarnessLanguageModel,
} from "@/modules/ai/lib/harnessModel";
import { generateText, streamText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runCodexTextPrompt,
  stopCodexTextPrompt,
  acquireHarnessBridge,
  releaseBridge,
  homeDir,
  chatContext,
} = vi.hoisted(() => ({
  runCodexTextPrompt: vi.fn(),
  stopCodexTextPrompt: vi.fn(),
  acquireHarnessBridge: vi.fn(),
  releaseBridge: vi.fn(),
  homeDir: vi.fn(),
  chatContext: {
    cwd: "/workspace/project" as string | null,
    workspaceRoot: "/workspace/fallback" as string | null,
  },
}));

vi.mock("@/modules/harness/lib/harness/child", () => ({
  acquireHarnessBridge,
}));
vi.mock("@/modules/harness/lib/harness/codexText", () => ({
  runCodexTextPrompt,
  stopCodexTextPrompt,
}));
vi.mock("@/modules/harness/lib/harness/claudeText", () => ({
  runClaudeTextPrompt: vi.fn(),
  stopClaudeTextPrompt: vi.fn(),
}));
vi.mock("@/modules/harness/lib/harness/cursorText", () => ({
  runCursorTextPrompt: vi.fn(),
  stopCursorTextPrompt: vi.fn(),
}));
vi.mock("@/modules/harness/lib/harness/grokText", () => ({
  runGrokTextPrompt: vi.fn(),
  stopGrokTextPrompt: vi.fn(),
}));
vi.mock("@/modules/harness/lib/harness/opencodeText", () => ({
  runOpenCodeTextPrompt: vi.fn(),
  stopOpenCodeTextPrompt: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fs", () => ({ homeDir }));
vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: {
    getState: () => ({
      live: {
        getCwd: () => chatContext.cwd,
        getWorkspaceRoot: () => chatContext.workspaceRoot,
      },
    }),
  },
}));

describe("HarnessLanguageModel", () => {
  beforeEach(() => {
    runCodexTextPrompt.mockReset();
    stopCodexTextPrompt.mockReset();
    stopCodexTextPrompt.mockResolvedValue(undefined);
    acquireHarnessBridge.mockReset();
    acquireHarnessBridge.mockResolvedValue(releaseBridge);
    releaseBridge.mockReset();
    homeDir.mockReset();
    chatContext.cwd = "/workspace/project";
    chatContext.workspaceRoot = "/workspace/fallback";
  });

  it("routes Codex through the existing text adapter with the active cwd", async () => {
    runCodexTextPrompt.mockResolvedValue("Local response");
    const model = new HarnessLanguageModel("harness-codex");

    const result = await model.doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Inspect the project" }],
        },
      ],
    });
    const chunks: unknown[] = [];
    for await (const chunk of result.stream) chunks.push(chunk);

    expect(runCodexTextPrompt).toHaveBeenCalledWith({
      cwd: "/workspace/project",
      prompt: "[User]: Inspect the project",
      timeoutMs: 45_000,
    });
    expect(chunks).toContainEqual({
      type: "text-delta",
      id: "text-0",
      delta: "Local response",
    });
  });

  it("works through the installed AI SDK generateText pipeline", async () => {
    runCodexTextPrompt.mockResolvedValue("OK");

    const result = await generateText({
      model: createHarnessModel("harness-codex"),
      prompt: "Reply with OK.",
      maxOutputTokens: 8,
    });

    expect(result.text).toBe("OK");
  });

  it("uses native home when the settings window has no chat workspace", async () => {
    chatContext.cwd = null;
    chatContext.workspaceRoot = null;
    homeDir.mockResolvedValue("/home/local-user");
    runCodexTextPrompt.mockResolvedValue("OK");

    await expect(
      generateText({
        model: createHarnessModel("harness-codex"),
        prompt: "Reply with OK.",
      }),
    ).resolves.toMatchObject({ text: "OK" });

    expect(runCodexTextPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/home/local-user" }),
    );
  });

  it("works through the installed AI SDK streamText pipeline", async () => {
    runCodexTextPrompt.mockResolvedValue("Streamed response");

    const result = streamText({
      model: createHarnessModel("harness-codex"),
      prompt: "Inspect the project.",
    });

    await expect(result.text).resolves.toBe("Streamed response");
  });

  it("rejects when the local OAuth agent fails", async () => {
    runCodexTextPrompt.mockRejectedValue(new Error("OAuth session expired"));

    await expect(
      generateText({
        model: createHarnessModel("harness-codex"),
        prompt: "Reply with OK.",
      }),
    ).rejects.toThrow("OAuth session expired");
  });
  it("holds the harness event bridge for the whole run", async () => {
    // Without a lease the agent's stdout never reaches the runner: the child
    // spawns and the turn hangs until its own timeout. A harness tab used to
    // be the only thing installing the bridge, and the settings window that
    // runs the health check is a separate webview that never mounts one.
    let bridgeHeldDuringRun = false;
    runCodexTextPrompt.mockImplementation(async () => {
      bridgeHeldDuringRun =
        acquireHarnessBridge.mock.calls.length === 1 &&
        releaseBridge.mock.calls.length === 0;
      return "ok";
    });

    await generateText({
      model: new HarnessLanguageModel("harness-codex"),
      prompt: "Reply with OK.",
    });

    expect(bridgeHeldDuringRun).toBe(true);
    expect(releaseBridge).toHaveBeenCalledOnce();
  });

  it("releases the bridge when the run fails", async () => {
    runCodexTextPrompt.mockRejectedValue(new Error("binary missing"));

    await expect(
      generateText({
        model: new HarnessLanguageModel("harness-codex"),
        prompt: "Reply with OK.",
      }),
    ).rejects.toThrow();

    expect(releaseBridge).toHaveBeenCalledOnce();
  });

  it("settles on abort and tears the child down", async () => {
    // The runner takes a fixed timeout and knows nothing about the signal, so
    // an aborted health check would otherwise sit in "Testing..." until the
    // runner's own 45s elapsed.
    runCodexTextPrompt.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = generateText({
      model: new HarnessLanguageModel("harness-codex"),
      prompt: "Reply with OK.",
      abortSignal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(stopCodexTextPrompt).toHaveBeenCalled();
    expect(releaseBridge).toHaveBeenCalledOnce();
  });

  it("does not start a run for an already aborted signal", async () => {
    runCodexTextPrompt.mockResolvedValue("ok");
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateText({
        model: new HarnessLanguageModel("harness-codex"),
        prompt: "Reply with OK.",
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
