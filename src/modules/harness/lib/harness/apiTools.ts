import { buildTools, type ToolContext } from "@/modules/ai/tools/tools";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import { agentShellSessions } from "@/modules/ai/lib/ownedShellSessions";
import { isLocalPath } from "@/modules/workspace";

type Owner = { cwd: string; model: string; context: ToolContext };
const owners = new Map<string, Owner>();

export function apiToolContext(sessionId: string, cwd: string, model: string): ToolContext | null {
  if (!isLocalPath(cwd) || cwd.startsWith("~")) return null;
  const previous = owners.get(sessionId);
  if (previous?.cwd === cwd) {
    previous.model = model;
    return previous.context;
  }
  if (previous) {
    fileToolCallsFor(previous.context).forget();
    void agentShellSessions.retire(previous.context).catch(() => {});
  }
  const workspace = { kind: "local" as const };
  const owner = { cwd, model, context: undefined as unknown as ToolContext };
  const context: ToolContext = {
    getCwd: () => cwd,
    getWorkspaceRoot: () => cwd,
    getFileContext: () => ({ directory: cwd, workspace }),
    getFileRootContext: () => ({ root: cwd, workspace }),
    getModelId: () => owner.model,
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => sessionId,
  };
  owner.context = context;
  owners.set(sessionId, owner);
  return context;
}

export function buildApiTools(context: ToolContext) {
  const tools = buildTools(context);
  return {
    read_file: tools.read_file,
    list_directory: tools.list_directory,
    write_file: tools.write_file,
    create_directory: tools.create_directory,
    edit: tools.edit,
    multi_edit: tools.multi_edit,
    grep: tools.grep,
    glob: tools.glob,
    bash_run: tools.bash_run,
  };
}

export async function forgetApiTools(sessionId: string): Promise<void> {
  const owner = owners.get(sessionId);
  if (!owner) return;
  owners.delete(sessionId);
  fileToolCallsFor(owner.context).forget();
  await agentShellSessions.retire(owner.context);
}
