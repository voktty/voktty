import { requestRemoteResult } from "./client";

export type RemoteAgentProbe = {
  found: boolean;
  path?: string | null;
  version?: string | null;
  error?: string | null;
};

/** Asks the host helper where an agent CLI is installed and its version. */
export function probeRemoteAgent(
  sessionId: number,
  command: string,
): Promise<RemoteAgentProbe> {
  return requestRemoteResult<RemoteAgentProbe>(sessionId, "agent.probe", {
    command,
  });
}