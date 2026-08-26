import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateTerminalCommand } from "./generateTerminalCommand";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("@/modules/ai/lib/agent", () => ({
  buildConfiguredLanguageModel: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  requireAiRuntime: vi.fn(),
}));

vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: {
    getState: vi.fn().mockReturnValue({
      selectedModelId: "gpt-4o-mini",
      apiKeys: {},
      customEndpointKeys: {},
    }),
  },
}));

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: vi.fn().mockReturnValue({
      customEndpoints: [],
    }),
  },
}));

describe("generateTerminalCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses valid JSON response from model", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        command: "ls -lah",
        explanation: "List all files in long format including hidden",
      }),
    } as never);

    const res = await generateTerminalCommand({
      prompt: "list all files",
      shell: "bash",
      os: "Linux",
    });

    expect(res.command).toBe("ls -lah");
    expect(res.explanation).toBe(
      "List all files in long format including hidden",
    );
  });

  it("handles markdown json wrapped response", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text:
        "```json\n" +
        JSON.stringify({
          command: "Get-ChildItem -Force",
          explanation: "List all items including hidden in PowerShell",
        }) +
        "\n```",
    } as never);

    const res = await generateTerminalCommand({
      prompt: "list files powershell",
      shell: "powershell",
      os: "Windows",
    });

    expect(res.command).toBe("Get-ChildItem -Force");
    expect(res.explanation).toBe(
      "List all items including hidden in PowerShell",
    );
  });

  it("falls back gracefully when model responds with plain text command", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "$ git status --short",
    } as never);

    const res = await generateTerminalCommand({
      prompt: "check git status",
      shell: "bash",
      os: "macOS",
    });

    expect(res.command).toBe("git status --short");
  });
});
