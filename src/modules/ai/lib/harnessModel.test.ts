import {
  createHarnessModel,
  HarnessLanguageModel,
} from "@/modules/ai/lib/harnessModel";
import { generateText, streamText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCodexTextPrompt } = vi.hoisted(() => ({
  runCodexTextPrompt: vi.fn(),
}));

vi.mock("@/modules/harness/lib/harness/codexText", () => ({
  runCodexTextPrompt,
}));
vi.mock("@/modules/harness/lib/harness/claudeText", () => ({
  runClaudeTextPrompt: vi.fn(),
}));
vi.mock("@/modules/harness/lib/harness/cursorText", () => ({
  runCursorTextPrompt: vi.fn(),
}));
vi.mock("@/modules/harness/lib/harness/grokText", () => ({
  runGrokTextPrompt: vi.fn(),
}));
vi.mock("@/modules/harness/lib/harness/opencodeText", () => ({
  runOpenCodeTextPrompt: vi.fn(),
}));
vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: {
    getState: () => ({
      live: {
        getCwd: () => "/workspace/project",
        getWorkspaceRoot: () => "/workspace/fallback",
      },
    }),
  },
}));

describe("HarnessLanguageModel", () => {
  beforeEach(() => {
    runCodexTextPrompt.mockReset();
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
});
