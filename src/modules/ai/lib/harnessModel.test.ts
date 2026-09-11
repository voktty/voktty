import { beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessLanguageModel } from "@/modules/ai/lib/harnessModel";

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
      prompt: [{ role: "user", content: "Inspect the project" }],
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
      textDelta: "Local response",
    });
  });
});
