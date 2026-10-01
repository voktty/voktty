import { describe, expect, it } from "vitest";
import { isMcpCommand, MCP_COMMAND } from "./mcpCommand";

describe("mcpCommand", () => {
  it("matches /mcp command with or without whitespace", () => {
    expect(isMcpCommand("/mcp")).toBe(true);
    expect(isMcpCommand("  /mcp  ")).toBe(true);
    expect(isMcpCommand("/MCP")).toBe(true);
    expect(isMcpCommand("/mcp extra text")).toBe(false);
    expect(isMcpCommand("hello")).toBe(false);
  });

  it("has correct command schema metadata", () => {
    expect(MCP_COMMAND.name).toBe("mcp");
    expect(MCP_COMMAND.invocation).toBe("mcp");
  });
});
