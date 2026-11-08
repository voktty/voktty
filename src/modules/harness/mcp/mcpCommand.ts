import { t } from "@/modules/i18n";

export const MCP_COMMAND = {
  kind: "builtin" as const,
  name: "mcp",
  invocation: "mcp",
  get description() {
    return t("harness.commands.mcpDesc");
  },
  scope: "builtin" as const,
  source: "monocode" as const,
};

export function isMcpCommand(text: string): boolean {
  return /^\s*\/mcp\s*$/i.test(text);
}
