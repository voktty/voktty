export const MCP_COMMAND = {
  kind: "builtin" as const,
  name: "mcp",
  invocation: "mcp",
  description: "Find an MCP server for this message.",
  scope: "builtin" as const,
  source: "monocode" as const,
};

export function isMcpCommand(text: string): boolean {
  return /^\s*\/mcp\s*$/i.test(text);
}
