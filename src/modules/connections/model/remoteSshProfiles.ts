import type { RemoteSshConnection } from "@/modules/remote/client";
import type { SshConnection } from "@/modules/ssh/types";
import { type SshConnectionConfig, type WorkspaceEnv, useWorkspaceEnvStore } from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { RemoteMachine } from "./protocol";

const ENVIRONMENT_PREFIX = "voktty-ssh-";
const MAX_CONNECTION_ID_LENGTH = 256;

export function remoteSshEnvironmentId(connectionId: string): string {
  if (
    !connectionId ||
    connectionId.trim() !== connectionId ||
    connectionId.length > MAX_CONNECTION_ID_LENGTH
  ) {
    throw new Error("The saved SSH connection has an invalid id.");
  }
  return `${ENVIRONMENT_PREFIX}${encodeURIComponent(connectionId)}`;
}

export function remoteSshConnectionIdForEnvironment(
  environmentId: string,
): string | undefined {
  if (!environmentId.startsWith(ENVIRONMENT_PREFIX)) return undefined;
  try {
    const connectionId = decodeURIComponent(
      environmentId.slice(ENVIRONMENT_PREFIX.length),
    );
    return connectionId && connectionId.length <= MAX_CONNECTION_ID_LENGTH
      ? connectionId
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the saved profile that owns a remote environment id. A
 * `voktty-ssh-*` id only matches the saved profile with that exact id. Older
 * identities may also match a unique saved name or host. An unknown id never
 * falls back to the active connection: running on the wrong host is worse than
 * failing visibly.
 */
export function findSshProfile(
  environmentId: string,
  savedConnections?: SshConnection[],
  activeEnv?: WorkspaceEnv,
): SshConnection | undefined {
  const env = activeEnv ?? useWorkspaceEnvStore.getState().env;
  const decodedId = remoteSshConnectionIdForEnvironment(environmentId);
  const saved =
    savedConnections ?? usePreferencesStore.getState().sshConnections ?? [];

  const exactId = decodedId ?? environmentId;
  const direct = saved.find((c) => c.id === exactId);
  if (direct) return direct;
  if (env.kind === "ssh" && env.connection.id === exactId) {
    return env.connection;
  }
  if (decodedId !== undefined || environmentId.startsWith(ENVIRONMENT_PREFIX)) {
    return undefined;
  }

  const unique = (matches: SshConnection[]) =>
    matches.length === 1 ? matches[0] : undefined;
  const lowered = environmentId.toLowerCase();
  const byLabel = unique(
    saved.filter(
      (c) => c.name?.toLowerCase() === lowered || c.host?.toLowerCase() === lowered,
    ),
  );
  if (byLabel) return byLabel;

  const sshConfigAlias = environmentId.match(
    /^ssh-config-(.+)-\d+-[a-z0-9]+$/,
  )?.[1];
  if (sshConfigAlias) {
    const alias = sshConfigAlias.toLowerCase();
    return unique(
      saved.filter(
        (c) =>
          c.name?.toLowerCase() === alias ||
          c.host?.toLowerCase() === alias ||
          c.id.includes(sshConfigAlias),
      ),
    );
  }
  return undefined;
}
export function remoteSshConnectionForProfile(
  profile: SshConnection,
): RemoteSshConnection {
  const host = profile.host.trim();
  if (!host) throw new Error("The saved SSH connection has no host.");
  const user = profile.user?.trim();
  const identityFile = profile.identityFile?.trim();
  const extraArgs = profile.extraArgs?.trim();
  const initialDirectory = profile.initialDirectory?.trim();
  return {
    host,
    ...(user ? { user } : {}),
    port: profile.port ?? 22,
    ...(identityFile ? { identityFile } : {}),
    ...(extraArgs ? { extraArgs } : {}),
    ...(initialDirectory ? { initialDirectory } : {}),
  };
}

export function remoteSshConnectionFor(
  machine: RemoteMachine,
  savedConnections: SshConnectionConfig[],
): RemoteSshConnection {
  const config = machine.ssh;
  if (!config) {
    throw new Error(
      "This remote project has no native SSH connection configured.",
    );
  }
  const parsed = parseSshTarget(config.target);
  if (!parsed) throw new Error("The remote machine has an invalid SSH target.");
  const port = config.port ?? 22;
  const matching = savedConnections.filter(
    (connection) =>
      connection.host.toLowerCase() === parsed.host.toLowerCase() &&
      (!parsed.user ||
        (connection.user ?? "").toLowerCase() === parsed.user.toLowerCase()) &&
      (connection.port ?? 22) === port,
  );
  const saved = matching.length === 1 ? matching[0] : undefined;
  return {
    host: parsed.host,
    ...((parsed.user ?? saved?.user)
      ? { user: parsed.user ?? saved?.user }
      : {}),
    port,
    ...(saved?.identityFile ? { identityFile: saved.identityFile } : {}),
    ...(saved?.extraArgs ? { extraArgs: saved.extraArgs } : {}),
    ...(saved?.initialDirectory
      ? { initialDirectory: saved.initialDirectory }
      : {}),
  };
}

function parseSshTarget(value: string): { host: string; user?: string } | null {
  const target = value.trim();
  if (
    !target ||
    target.length > 255 ||
    target.startsWith("-") ||
    target.split("@").length > 2
  ) {
    return null;
  }
  const separator = target.lastIndexOf("@");
  const user = separator >= 0 ? target.slice(0, separator) : undefined;
  const host = separator >= 0 ? target.slice(separator + 1) : target;
  const validUser = !user || /^[A-Za-z0-9._:+-]+$/.test(user);
  const bracketedIpv6 =
    host.startsWith("[") &&
    host.endsWith("]") &&
    /^[A-Fa-f0-9:.]+$/.test(host.slice(1, -1));
  const validHost =
    /^[A-Za-z0-9._-]+$/.test(host) ||
    bracketedIpv6 ||
    (/^[A-Fa-f0-9:.]+$/.test(host) && host.includes(":"));
  if (
    !host ||
    host.startsWith("-") ||
    (separator >= 0 && !user) ||
    !validUser ||
    !validHost
  ) {
    return null;
  }
  return { host, ...(user ? { user } : {}) };
}
