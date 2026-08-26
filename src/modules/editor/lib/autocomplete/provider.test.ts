import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildLanguageModelMock, generateTextMock } = vi.hoisted(() => ({
  buildLanguageModelMock: vi.fn(),
  generateTextMock: vi.fn(),
}));

vi.mock("@/modules/ai/lib/agent", () => ({
  buildLanguageModel: buildLanguageModelMock,
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

import {
  CompletionRequestError,
  requestCompletion,
  requestCompletionDetailed,
} from "./provider";

beforeEach(() => {
  buildLanguageModelMock.mockReset();
  generateTextMock.mockReset();
});

describe("requestCompletion", () => {
  it("sends non-thinking mode and a completion-sized budget to DeepSeek", async () => {
    buildLanguageModelMock.mockResolvedValue({ provider: "deepseek.chat" });
    generateTextMock.mockResolvedValue({ text: "return;" });

    await requestCompletion(
      {
        prefix: "function example() {\n  ",
        suffix: "\n}",
        filename: "example.php",
        language: "php",
        indentUnit: "  ",
      },
      {
        provider: "deepseek",
        modelId: "deepseek-v4-flash",
        apiKey: "sk-test",
        lmstudioBaseURL: "http://127.0.0.1:1234/v1",
      },
      new AbortController().signal,
    );

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 128,
        providerOptions: expect.objectContaining({
          deepseek: { thinking: { type: "disabled" } },
        }),
      }),
    );
  });

  it("retries Ollama once with low reasoning when none is unsupported", async () => {
    buildLanguageModelMock.mockResolvedValue({ provider: "ollama.chat" });
    generateTextMock
      .mockRejectedValueOnce(
        new Error("Unsupported parameter: reasoning_effort none"),
      )
      .mockResolvedValueOnce({ text: " b" });

    const text = await requestCompletion(
      {
        prefix: "function sum(a, b) {\n  return a +",
        suffix: ";\n}",
        filename: "example.js",
        language: "javascript",
        indentUnit: "  ",
      },
      {
        provider: "ollama",
        modelId: "gpt-oss:20b",
        apiKey: null,
        lmstudioBaseURL: "http://localhost:1234/v1",
        ollamaBaseURL: "http://localhost:11434/v1",
      },
      new AbortController().signal,
    );

    expect(text).toBe(" b");
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(generateTextMock.mock.calls[1][0]).toMatchObject({
      providerOptions: { ollama: { reasoningEffort: "low" } },
    });
  });

  it("does not retry authentication failures", async () => {
    buildLanguageModelMock.mockResolvedValue({ provider: "ollama.chat" });
    generateTextMock.mockRejectedValue(new Error("401 Unauthorized"));

    await expect(
      requestCompletion(
        {
          prefix: "const value =",
          suffix: ";",
          filename: "example.js",
          language: "javascript",
          indentUnit: "  ",
        },
        {
          provider: "ollama",
          modelId: "gpt-oss:20b",
          apiKey: null,
          lmstudioBaseURL: "http://localhost:1234/v1",
          ollamaBaseURL: "http://localhost:11434/v1",
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "authentication",
    } satisfies Partial<CompletionRequestError>);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it.each(["429 Rate limit exceeded", "Network fetch failed"])(
    "does not retry a non-recoverable failure: %s",
    async (message) => {
      buildLanguageModelMock.mockResolvedValue({ provider: "ollama.chat" });
      generateTextMock.mockRejectedValue(new Error(message));

      await expect(
        requestCompletion(
          {
            prefix: "const value =",
            suffix: ";",
            filename: "example.js",
            language: "javascript",
            indentUnit: "  ",
          },
          {
            provider: "ollama",
            modelId: "gpt-oss:20b",
            apiKey: null,
            lmstudioBaseURL: "http://localhost:1234/v1",
            ollamaBaseURL: "http://localhost:11434/v1",
          },
          new AbortController().signal,
        ),
      ).rejects.toBeInstanceOf(CompletionRequestError);
      expect(generateTextMock).toHaveBeenCalledTimes(1);
    },
  );

  it("retries one empty response with the same model", async () => {
    buildLanguageModelMock.mockResolvedValue({ provider: "openai.chat" });
    generateTextMock
      .mockResolvedValueOnce({ text: "" })
      .mockResolvedValueOnce({ text: "return total;" });

    const result = await requestCompletionDetailed(
      {
        prefix: "function total() {\n  ",
        suffix: "\n}",
        filename: "example.js",
        language: "javascript",
        indentUnit: "  ",
      },
      {
        provider: "openai",
        modelId: "gpt-4.1-mini",
        apiKey: "sk-test",
        lmstudioBaseURL: "http://localhost:1234/v1",
      },
      new AbortController().signal,
    );

    expect(result.text).toBe("return total;");
    expect(result.attemptsUsed).toBe(2);
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });
});
