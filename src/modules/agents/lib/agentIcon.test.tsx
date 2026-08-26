import { describe, expect, it } from "vitest";
import { agentIconKind } from "./agentIcon";

describe("agentIconKind", () => {
  it.each([
    ["Claude Code", "claude"],
    ["codex.exe", "codex"],
    ["antigravity", "antigravity"],
    ["kimi-code", "kimi"],
    ["deepseek-cli", "deepseek"],
    ["qwen", "qwen"],
    ["mistral", "mistral"],
    ["perplexity", "perplexity"],
  ] as const)("preserves the brand family for %s", (agent, expected) => {
    expect(agentIconKind(agent)).toBe(expected);
  });

  it("falls back to a generic AI icon for unknown tools", () => {
    expect(agentIconKind("custom-terminal-agent")).toBe("generic");
  });
});
