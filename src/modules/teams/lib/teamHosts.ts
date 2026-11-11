import { invoke } from "@tauri-apps/api/core";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SshConnection } from "@/modules/ssh/types";
import type { AgentDefinition, AgentRoster } from "@/modules/workspace-kit/lib/configTypes";
import {
  TEAM_HOSTS_SCHEMA,
  type TeamHostConfig,
  type TeamHostsState,
} from "../types";
import { normalizePath } from "./teamFs";
import { nativeProjectPath } from "@/modules/teams/lib/teamFileIo";

export type ResolvedHost =
  | { kind: "local" }
  | {
      kind: "ssh";
      alias: string;
      connectionId: string;
      connection: SshConnection;
      remoteProjectPath: string;
      sessionCwd: string;
    }
  | {
      kind: "unconfigured";
      alias: string;
      reason: string;
    }
  | {
      kind: "invalid";
      alias?: string;
      reason: string;
    };

export type NativeHostRecord = {
  canonical_project: string;
  alias: string;
  connection_id: string;
  remote_path: string;
  updated_at: string;
};

export function parseAgentHost(
  hostValue: string | undefined,
):
  | { kind: "local" }
  | { kind: "ssh"; alias: string }
  | { kind: "invalid"; reason: string } {
  if (hostValue === undefined || hostValue === "local") {
    return { kind: "local" };
  }
  if (typeof hostValue !== "string") {
    return { kind: "invalid", reason: "Host value must be a string" };
  }
  const trimmed = hostValue.trim();
  if (trimmed === "" || trimmed === "local") {
    return { kind: "local" };
  }
  if (!trimmed.startsWith("ssh:")) {
    return {
      kind: "invalid",
      reason: `Unsupported host scheme in '${hostValue}' (must be 'local' or 'ssh:<alias>')`,
    };
  }
  const alias = trimmed.slice(4).trim();
  if (
    !alias ||
    alias === "." ||
    alias === ".." ||
    alias.includes("..") ||
    alias.includes("/") ||
    alias.includes("\\") ||
    !/^[a-zA-Z0-9_.-]+$/.test(alias)
  ) {
    return {
      kind: "invalid",
      reason: `Invalid SSH host alias '${alias}' (allowed characters: letters, numbers, dot, dash, underscore, no '..', no separators)`,
    };
  }
  return { kind: "ssh", alias: alias.toLowerCase() };
}

export function assertSafeRemotePath(remotePath: string): void {
  if (!remotePath || typeof remotePath !== "string") {
    throw new Error("Remote project path must be a non-empty string");
  }
  const trimmed = remotePath.trim();
  if (!trimmed) {
    throw new Error("Remote project path must be a non-empty string");
  }
  if (trimmed === "/" || /^\/+$/.test(trimmed)) {
    throw new Error("Remote project path cannot be the root directory ('/')");
  }
  if (trimmed.includes("\0")) {
    throw new Error("Remote project path must not contain null bytes");
  }
  if (trimmed.includes("\\")) {
    throw new Error("Remote project path must use forward slashes (Unix style)");
  }
  if (!trimmed.startsWith("/")) {
    throw new Error("Remote project path must be an absolute path starting with '/'");
  }

  // Check for path traversal components
  const segments = trimmed.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error("Remote project path cannot be the root directory ('/')");
  }
  if (segments.includes("..") || segments.includes(".")) {
    throw new Error("Path traversal ('..' or '.') is strictly forbidden in remote project path");
  }
}

/**
 * Reads team host mappings from native app state via Rust (S4).
 * Never reads from .voktty/state/hosts.json in the project workspace.
 */
export async function readTeamHosts(projectPath: string): Promise<TeamHostsState> {
  try {
    const raw = await invoke<Record<string, NativeHostRecord>>(
      "team_read_host_mappings",
      { projectPath: await nativeProjectPath(projectPath) },
    );
    const hosts: Record<string, TeamHostConfig> = {};
    if (raw && typeof raw === "object") {
      for (const [alias, rec] of Object.entries(raw)) {
        if (rec && typeof rec.connection_id === "string") {
          hosts[alias] = {
            connectionId: rec.connection_id,
            ...(rec.remote_path ? { remoteProjectPath: rec.remote_path } : {}),
          };
        }
      }
    }
    return {
      $schema: TEAM_HOSTS_SCHEMA,
      version: 1,
      updatedAt: new Date().toISOString(),
      hosts,
    };
  } catch {
    return {
      $schema: TEAM_HOSTS_SCHEMA,
      version: 1,
      updatedAt: new Date().toISOString(),
      hosts: {},
    };
  }
}

/**
 * Saves a host mapping exclusively to native app state via Rust (S4).
 * Only the project owner from the UI can write this.
 */
export async function saveTeamHostMapping(
  projectPath: string,
  hostAlias: string,
  connectionId: string,
  remoteProjectPath: string,
): Promise<void> {
  const parsed = parseAgentHost(`ssh:${hostAlias}`);
  if (parsed.kind !== "ssh") {
    throw new Error(parsed.kind === "invalid" ? parsed.reason : "Invalid host alias");
  }
  if (!connectionId || typeof connectionId !== "string" || !connectionId.trim()) {
    throw new Error("connectionId is required to map team host");
  }
  if (!remoteProjectPath || typeof remoteProjectPath !== "string" || !remoteProjectPath.trim()) {
    throw new Error("Remote project path is required to map team host");
  }
  const rawTrimmed = remoteProjectPath.trim();
  if (rawTrimmed === "/" || /^\/+$/.test(rawTrimmed)) {
    throw new Error("Remote project path cannot be the root directory ('/')");
  }
  const cleanRemotePath = normalizePath(rawTrimmed);
  assertSafeRemotePath(cleanRemotePath);

  await invoke("team_save_host_mapping", {
    projectPath: await nativeProjectPath(projectPath),
    alias: parsed.alias,
    connectionId: connectionId.trim(),
    remotePath: cleanRemotePath,
  });
}

/**
 * Removes a host mapping from native app state via Rust (S4).
 */
export async function removeTeamHostMapping(
  projectPath: string,
  hostAlias: string,
): Promise<void> {
  const parsed = parseAgentHost(`ssh:${hostAlias}`);
  if (parsed.kind !== "ssh") {
    throw new Error(parsed.kind === "invalid" ? parsed.reason : "Invalid host alias");
  }
  await invoke("team_remove_host_mapping", {
    projectPath: await nativeProjectPath(projectPath),
    alias: parsed.alias,
  });
}

/**
 * Compatibility helper: saves mappings into native store.
 * Never writes to project workspace files.
 */
export async function writeTeamHosts(
  projectPath: string,
  state: TeamHostsState,
): Promise<void> {
  for (const [alias, config] of Object.entries(state.hosts)) {
    if (config?.connectionId && config.remoteProjectPath) {
      await saveTeamHostMapping(
        projectPath,
        alias,
        config.connectionId,
        config.remoteProjectPath,
      );
    }
  }
}

/**
 * Resolves host configuration for an agent.
 *
 * CRITICAL SECURITY INVARIANT (S4):
 * Resolution is backed by Rust native storage outside the workspace.
 * Any hosts.json created by agents in .voktty/state/ is completely ignored.
 */
export async function resolveHostForAgent(
  agent: AgentDefinition,
  roster: AgentRoster,
  projectPath: string,
  availableSshConnections?: readonly SshConnection[] | null,
): Promise<ResolvedHost> {
  if (projectPath.startsWith("remote://")) {
    const { parseRemotePath } = await import("@/modules/connections/model/remoteProjects");
    const { remoteSshConnectionIdForEnvironment } = await import("@/modules/connections/model/remoteSshProfiles");
    const remote = parseRemotePath(projectPath);
    const connectionId = remote && remoteSshConnectionIdForEnvironment(remote.environmentId);
    const connection = (availableSshConnections ?? usePreferencesStore.getState().sshConnections ?? [])
      .find((candidate) => candidate.id === connectionId);
    if (!remote || !connectionId || !connection) {
      return { kind: "unconfigured", alias: connectionId || "", reason: "The remote team's SSH connection is not configured on this machine" };
    }
    try {
      assertSafeRemotePath(remote.hostPath);
    } catch (error) {
      return { kind: "invalid", reason: error instanceof Error ? error.message : String(error) };
    }
    if ((agent.host ?? roster.defaults?.host)?.startsWith("ssh:")) {
      return { kind: "invalid", reason: "A remote team runs on its project's SSH host; remove SSH host aliases from its roster" };
    }
    return {
      kind: "ssh", alias: connection.id, connectionId: connection.id, connection,
      remoteProjectPath: remote.hostPath, sessionCwd: projectPath,
    };
  }
  const hostVal = agent.host ?? roster.defaults?.host;
  const parsed = parseAgentHost(hostVal);
  if (parsed.kind === "local") {
    return { kind: "local" };
  }
  if (parsed.kind === "invalid") {
    return { kind: "invalid", reason: parsed.reason };
  }

  const alias = parsed.alias;
  const hostsState = await readTeamHosts(projectPath);
  const connections =
    availableSshConnections ??
    usePreferencesStore.getState().sshConnections ??
    [];

  const mapping = hostsState.hosts[alias];
  let connection: SshConnection | undefined;
  let remotePath = "";

  if (mapping) {
    connection = connections.find(
      (c) => c.id === mapping.connectionId || c.name === mapping.connectionId,
    );
    if (!connection) {
      return {
        kind: "unconfigured",
        alias,
        reason: `SSH connection profile '${mapping.connectionId}' linked to alias '${alias}' not found in local settings`,
      };
    }
    if (mapping.remoteProjectPath) {
      remotePath = mapping.remoteProjectPath;
    }
  } else {
    // If no explicit mapping in native store, check if an existing connection directly matches the alias
    connection = connections.find(
      (c) => c.id === alias || c.name === alias,
    );
    if (!connection) {
      return {
        kind: "unconfigured",
        alias,
        reason: `Host 'ssh:${alias}' is not configured on this machine`,
      };
    }
    if (connection.initialDirectory) {
      remotePath = connection.initialDirectory;
    }
  }

  if (!remotePath || remotePath === "/" || /^\/+$/.test(remotePath.trim())) {
    return {
      kind: "unconfigured",
      alias,
      reason: `Remote project path for host 'ssh:${alias}' is not configured. Please link this host in the Team Board and provide a remote project path (root '/' is not allowed).`,
    };
  }

  try {
    assertSafeRemotePath(remotePath);
  } catch (err: unknown) {
    return {
      kind: "invalid",
      alias,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const cleanPath = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
  const sessionCwd = `remote://voktty-ssh-${encodeURIComponent(connection.id)}${cleanPath}`;

  return {
    kind: "ssh",
    alias,
    connectionId: connection.id,
    connection,
    remoteProjectPath: remotePath,
    sessionCwd,
  };
}
