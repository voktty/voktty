import type { WorkspaceEnv } from "@/modules/workspace";

export function terminalProjectMetadata(
  value: unknown,
  workspace?: WorkspaceEnv,
): { projectCwd?: string } {
  if (
    typeof value !== "string" ||
    value.length > 32768 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    return {};
  const path = value.replace(/\\/g, "/");
  if (
    !path.startsWith("/") &&
    !/^[A-Za-z]:\//.test(path) &&
    !/^remote:\/\/[A-Za-z0-9_.~%-]+\//.test(path)
  )
    return {};
  if (workspace && path.startsWith("remote://") !== (workspace.kind === "ssh"))
    return {};
  return { projectCwd: path };
}
