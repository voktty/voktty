import { remoteMachineFor } from "@/modules/connections/model/connections";
import type { RemoteMachine } from "@/modules/connections/model/protocol";
import { parseRemotePath } from "@/modules/connections/model/remoteProjects";
import {
  assertSupportedOpenCodeVersion,
  parseOpenCodeVersion,
} from "@/modules/harness/lib/harness/opencodeProtocol";
import {
  closeRemoteWorkspace,
  openRemoteTunnel,
  openRemoteWorkspace,
  type RemoteSessionInfo,
  type RemoteSshConnection,
  runRemoteOpenCodeServiceAction,
} from "@/modules/remote/client";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SshConnectionConfig } from "@/modules/workspace";

export type RemoteOpenCodeService = {
  url: string;
  password: string;
  directory: string;
  sessionId: number;
};

type OpenDependencies = {
  machineFor: (environmentId: string) => Promise<RemoteMachine | undefined>;
  sshConnections: () => SshConnectionConfig[];
  openWorkspace: typeof openRemoteWorkspace;
  openTunnel: typeof openRemoteTunnel;
  serviceAction: typeof runRemoteOpenCodeServiceAction;
  closeWorkspace: typeof closeRemoteWorkspace;
};

type Entry = {
  owners: Set<string>;
  service: Promise<RemoteOpenCodeService>;
  closing: boolean;
  closed: Promise<void>;
  resolveClosed: () => void;
};

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

function remoteServicePort(output: string): number | null {
  for (const line of output.split("\n")) {
    const match = line
      .trim()
      .match(/^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/?$/i);
    const port = match ? Number(match[1]) : NaN;
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  }
  return null;
}

async function openService(
  cwd: string,
  environmentId: string,
  dependencies: OpenDependencies,
): Promise<RemoteOpenCodeService> {
  const machine = await dependencies.machineFor(environmentId);
  if (!machine) throw new Error("The remote machine is no longer connected.");
  const connection = remoteSshConnectionFor(
    machine,
    dependencies.sshConnections(),
  );
  const session: RemoteSessionInfo = await dependencies.openWorkspace(
    connection,
    cwd,
  );
  try {
    const versionOutput = await dependencies.serviceAction(
      session.session_id,
      "version",
      cwd,
    );
    const version = parseOpenCodeVersion(versionOutput);
    const generation = assertSupportedOpenCodeVersion(version);
    if (generation !== "v2") {
      throw new Error(
        "Remote Harness sessions require OpenCode 2.0.15 or newer.",
      );
    }

    let output = await dependencies
      .serviceAction(session.session_id, "status", cwd)
      .catch(() => "");
    let remotePort = remoteServicePort(output);
    if (!remotePort) {
      output = await dependencies
        .serviceAction(session.session_id, "start", cwd)
        .catch(() => "");
      remotePort = remoteServicePort(output);
    }
    if (!remotePort) {
      output = await dependencies
        .serviceAction(session.session_id, "status", cwd)
        .catch(() => "");
      remotePort = remoteServicePort(output);
    }
    if (!remotePort) {
      throw new Error(
        "Remote OpenCode did not report its loopback service port.",
      );
    }

    const password = (
      await dependencies.serviceAction(session.session_id, "password", cwd)
    ).trim();
    if (!password)
      throw new Error("Remote OpenCode did not report a service password.");

    const tunnel = await dependencies.openTunnel(
      session.session_id,
      remotePort,
    );
    return {
      url: `http://127.0.0.1:${tunnel.localPort}`,
      password,
      directory: cwd,
      sessionId: session.session_id,
    };
  } catch (error) {
    await dependencies
      .closeWorkspace(session.session_id)
      .catch(() => undefined);
    throw error;
  }
}

export function createRemoteOpenCodeServiceManager(
  dependencies: OpenDependencies,
  maxSessions = 8,
) {
  const entries = new Map<string, Entry>();
  const ownerKeys = new Map<string, string>();

  const finishEntry = (key: string, entry: Entry) => {
    if (entries.get(key) === entry) entries.delete(key);
    entry.resolveClosed();
  };

  const closeEntry = (key: string, entry: Entry) => {
    if (entry.closing) return entry.closed;
    entry.closing = true;
    void entry.service
      .then((service) => dependencies.closeWorkspace(service.sessionId))
      .catch(() => undefined)
      .finally(() => finishEntry(key, entry));
    return entry.closed;
  };

  const release = async (ownerId: string): Promise<void> => {
    const key = ownerKeys.get(ownerId);
    if (!key) return;
    ownerKeys.delete(ownerId);
    const entry = entries.get(key);
    if (!entry) return;
    entry.owners.delete(ownerId);
    if (entry.owners.size === 0) await closeEntry(key, entry);
  };

  const acquire = async (
    ownerId: string,
    cwd: string,
  ): Promise<RemoteOpenCodeService | undefined> => {
    const remote = parseRemotePath(cwd);
    if (!remote) return undefined;
    const owner = ownerId.trim();
    if (!owner) throw new Error("Remote OpenCode session id is required.");
    const key = JSON.stringify([remote.environmentId, remote.hostPath]);
    const previous = ownerKeys.get(owner);
    if (previous && previous !== key) await release(owner);
    let entry = entries.get(key);
    if (entry?.closing) {
      await entry.closed;
      return acquire(owner, cwd);
    }
    if (!entry) {
      if (entries.size >= maxSessions) {
        throw new Error(
          "Close an unused remote OpenCode session before opening another machine.",
        );
      }
      let resolveClosed: () => void = () => {};
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      const service = openService(
        remote.hostPath,
        remote.environmentId,
        dependencies,
      );
      entry = {
        owners: new Set(),
        service,
        closing: false,
        closed,
        resolveClosed,
      };
      entries.set(key, entry);
      const createdEntry = entry;
      void service.catch(() => finishEntry(key, createdEntry));
    }
    entry.owners.add(owner);
    ownerKeys.set(owner, key);
    try {
      return await entry.service;
    } catch (error) {
      await release(owner);
      throw error;
    }
  };

  return { acquire, release };
}

const remoteOpenCodeServices = createRemoteOpenCodeServiceManager({
  machineFor: remoteMachineFor,
  sshConnections: () => usePreferencesStore.getState().sshConnections ?? [],
  openWorkspace: openRemoteWorkspace,
  openTunnel: openRemoteTunnel,
  serviceAction: runRemoteOpenCodeServiceAction,
  closeWorkspace: closeRemoteWorkspace,
});

export const acquireRemoteOpenCodeService = remoteOpenCodeServices.acquire;
export const releaseRemoteOpenCodeService = remoteOpenCodeServices.release;
