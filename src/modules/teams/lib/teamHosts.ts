import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile } from "@/modules/harness/lib/fs";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SshConnection } from "@/modules/ssh/types";
import type { AgentDefinition, AgentRoster } from "@/modules/workspace-kit/lib/configTypes";
import {
  TEAM_HOSTS_SCHEMA,
  type TeamHostConfig,
  type TeamHostsState,
} from "../types";
import { normalizePath, teamPath } from "./teamFs";

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
    !/^[a-zA-Z0-9_.-]+$/.test(alias)
  ) {
    return {
      kind: "invalid",
      reason: `Invalid SSH host alias '${alias}' (allowed characters: letters, numbers, dot, dash, underscore, no '..')`,
    };
  }
  return { kind: "ssh", alias };
}

export function assertSafeRemotePath(remotePath: string): void {
  if (!remotePath || typeof remotePath !== "string") {
    throw new Error("Remote project path must be a non-empty string");
  }
  if (remotePath.includes("\0")) {
    throw new Error("Remote project path must not contain null bytes");
  }
  if (remotePath.includes("\\")) {
    throw new Error("Remote project path must use forward slashes (Unix style)");
  }
  if (!remotePath.startsWith("/")) {
    throw new Error("Remote project path must be an absolute path starting with '/'");
  }

  // Check for path traversal components
  const segments = remotePath.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new Error("Path traversal '..' is strictly forbidden in remote project path");
    }
  }
}

export async function readTeamHosts(projectPath: string): Promise<TeamHostsState> {
  const filePath = teamPath(projectPath, ".voktty", "state", "hosts.json");
  try {
    const content = await readTextFile(filePath);
    const parsed = JSON.parse(content) as Partial<TeamHostsState>;
    if (parsed && typeof parsed === "object" && parsed.hosts && typeof parsed.hosts === "object") {
      const sanitizedHosts: Record<string, TeamHostConfig> = {};
      for (const [alias, config] of Object.entries(parsed.hosts)) {
        if (config && typeof config === "object" && typeof config.connectionId === "string") {
          sanitizedHosts[alias] = {
            connectionId: config.connectionId,
            ...(typeof config.remoteProjectPath === "string"
              ? { remoteProjectPath: config.remoteProjectPath }
              : {}),
          };
        }
      }
      return {
        $schema: TEAM_HOSTS_SCHEMA,
        version: 1,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        hosts: sanitizedHosts,
      };
    }
  } catch {
    // If not exists or parse error, return fresh state
  }

  return {
    $schema: TEAM_HOSTS_SCHEMA,
    version: 1,
    updatedAt: new Date().toISOString(),
    hosts: {},
  };
}

export async function writeTeamHosts(
  projectPath: string,
  state: TeamHostsState,
): Promise<void> {
  const stateDir = teamPath(projectPath, ".voktty", "state");
  const filePath = teamPath(stateDir, "hosts.json");

  try {
    await invoke("fs_create_dir", { path: stateDir });
  } catch {
    // Directory may already exist
  }

  // Security invariant: sanitize all host mappings and strictly strip credentials/keys/tokens
  const cleanHosts: Record<string, TeamHostConfig> = {};
  for (const [alias, config] of Object.entries(state.hosts)) {
    if (!config || typeof config !== "object" || !config.connectionId) {
      continue;
    }
    const cleanConfig: TeamHostConfig = {
      connectionId: String(config.connectionId),
    };
    if (config.remoteProjectPath && typeof config.remoteProjectPath === "string") {
      assertSafeRemotePath(config.remoteProjectPath);
      cleanConfig.remoteProjectPath = normalizePath(config.remoteProjectPath);
    }
    // Delete any potential leaked keys or credentials
    const dirty = cleanConfig as Record<string, unknown>;
    delete dirty.password;
    delete dirty.key;
    delete dirty.privateKey;
    delete dirty.token;
    delete dirty.agentToken;
    delete dirty.secret;
    delete dirty.credential;

    cleanHosts[alias] = cleanConfig;
  }

  const payload: TeamHostsState = {
    $schema: TEAM_HOSTS_SCHEMA,
    version: 1,
    updatedAt: new Date().toISOString(),
    hosts: cleanHosts,
  };

  await writeTextFile(filePath, JSON.stringify(payload, null, 2));
}

export async function saveTeamHostMapping(
  projectPath: string,
  hostAlias: string,
  connectionId: string,
  remoteProjectPath?: string,
): Promise<void> {
  const parsed = parseAgentHost(`ssh:${hostAlias}`);
  if (parsed.kind !== "ssh") {
    throw new Error(parsed.kind === "invalid" ? parsed.reason : "Invalid host alias");
  }
  if (!connectionId || typeof connectionId !== "string") {
    throw new Error("connectionId is required to map team host");
  }
  if (remoteProjectPath) {
    assertSafeRemotePath(remoteProjectPath);
  }

  const current = await readTeamHosts(projectPath);
  current.hosts[parsed.alias] = {
    connectionId,
    ...(remoteProjectPath ? { remoteProjectPath: normalizePath(remoteProjectPath) } : {}),
  };
  await writeTeamHosts(projectPath, current);
}

export async function removeTeamHostMapping(
  projectPath: string,
  hostAlias: string,
): Promise<void> {
  const parsed = parseAgentHost(`ssh:${hostAlias}`);
  if (parsed.kind !== "ssh") {
    throw new Error(parsed.kind === "invalid" ? parsed.reason : "Invalid host alias");
  }
  const current = await readTeamHosts(projectPath);
  delete current.hosts[parsed.alias];
  await writeTeamHosts(projectPath, current);
}

export async function resolveHostForAgent(
  agent: AgentDefinition,
  roster: AgentRoster,
  projectPath: string,
  availableSshConnections?: readonly SshConnection[] | null,
): Promise<ResolvedHost> {
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
  let remotePath = "/";

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
    // If no explicit mapping in hosts.json, check if an existing connection directly matches the alias
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
