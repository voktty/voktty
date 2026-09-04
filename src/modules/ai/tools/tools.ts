import { buildAgentHistoryTools } from "./agentHistory";
import { buildApiClientTools } from "./apiClient";
import { buildBrowserTools } from "./browser";
import { buildManagedAgentTools } from "./agent";
import { buildEditTools } from "./edit";
import { buildExtensionTools } from "./extensions";
import { buildDevelopmentTools } from "./development";
import { buildFsTools } from "./fs";
import { buildSearchTools } from "./search";
import { buildShellTools } from "./shell";
import { buildSubagentTools } from "./subagent";
import { buildTerminalTools } from "./terminal";
import { buildTodoTools } from "./todo";
import type { ToolSet } from "ai";

export { resolvePath, type ToolContext } from "./context";

/**
 * AI tool definitions.
 *
 * Approval policy:
 *  - Read-only tools (`read_file`, `list_directory`, `grep`, `glob`)
 *    auto-execute, but go through the security guard which refuses obvious
 *    secret paths (.env*, .ssh/, credentials, etc.).
 *  - Mutating tools (`write_file`, `edit`, `multi_edit`, `create_directory`,
 *    `run_command`) require explicit user approval — the AI SDK pauses on
 *    tool-call and surfaces a `tool-approval-request` part that the UI
 *    renders as a confirmation card.
 *  - `edit` / `multi_edit` additionally enforce a read-before-edit invariant
 *    (the model must have called read_file on the path earlier in the
 *    session).
 *
 * The model sees absolute paths only after they are resolved against the
 * active terminal's cwd (provided via `getCwd`); it should not invent paths
 * outside that.
 */
export function buildTools(
  ctx: import("./context").ToolContext,
  mcpTools: ToolSet = {},
) {
  const builtins = {
    ...buildFsTools(ctx),
    ...buildDevelopmentTools(ctx),
    ...buildEditTools(ctx),
    ...buildSearchTools(ctx),
    ...buildShellTools(ctx),
    ...buildSubagentTools(ctx),
    ...buildTerminalTools(ctx),
    ...buildTodoTools(ctx),
    ...buildManagedAgentTools(ctx),
    ...buildApiClientTools(ctx),
    ...buildAgentHistoryTools(ctx),
    ...buildBrowserTools(ctx),
  } as const;
  const safeMcpTools = Object.fromEntries(
    Object.entries(mcpTools).filter(([name]) => !(name in builtins)),
  );
  const reserved = new Set([...Object.keys(builtins), ...Object.keys(safeMcpTools)]);
  return {
    ...builtins,
    ...safeMcpTools,
    ...buildExtensionTools(reserved),
  };
}

export type ChatTools = ReturnType<typeof buildTools>;
