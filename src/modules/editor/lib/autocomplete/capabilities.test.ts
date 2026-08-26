import { describe, expect, it } from "vitest";
import {
  parseLmStudioCapabilities,
  parseOllamaCapabilities,
  runtimeApiRoot,
} from "./capabilities";

describe("local completion capabilities", () => {
  it("reads LM Studio reasoning options for the selected model", () => {
    expect(
      parseLmStudioCapabilities(
        {
          models: [
            {
              key: "qwen3-coder",
              capabilities: {
                reasoning: {
                  allowed_options: ["off", "on", "low"],
                  default: "on",
                },
              },
            },
          ],
        },
        "qwen3-coder",
      ),
    ).toEqual({
      source: "lmstudio",
      reasoning: {
        supported: true,
        allowed: ["off", "on", "low"],
        default: "on",
      },
    });
  });

  it("recognizes Ollama thinking support and GPT-OSS limits", () => {
    expect(
      parseOllamaCapabilities(
        { capabilities: ["completion", "thinking"] },
        "gpt-oss:20b",
      ),
    ).toEqual({
      source: "ollama",
      reasoning: {
        supported: true,
        allowed: ["low", "medium", "high"],
        default: "medium",
      },
    });
  });

  it("derives native runtime roots from OpenAI-compatible base URLs", () => {
    expect(runtimeApiRoot("http://localhost:11434/v1")).toBe(
      "http://localhost:11434",
    );
    expect(runtimeApiRoot("http://localhost:1234/proxy/v1/")).toBe(
      "http://localhost:1234/proxy",
    );
  });
});
