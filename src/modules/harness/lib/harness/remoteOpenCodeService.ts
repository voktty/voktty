import { remoteMachineFor } from "@/modules/connections/model/connections";
import type { RemoteMachine } from "@/modules/connections/model/protocol";
import {
  findSshProfile,
  remoteSshConnectionFor,
  remoteSshConnectionForProfile,
  remoteSshConnectionIdForEnvironment,
} from "@/modules/connections/model/remoteSshProfiles";
import {
  parseRemotePath,
  relativeWithinProject,
  remoteProjectForPath,
  remoteProjectKey,
} from "@/modules/connections/model/remoteProjects";
import {
  harnessProjectEnvironmentFor,
  type HarnessRemoteEnv,
  useHarnessProjectEnvStore,
} from "@/modules/harness/lib/harnessEnvStore";
import { remoteSessions } from "@/modules/remote/sessionManager";
import {
  isSessionLostError,
  RemoteSessionConnectionChangedError,
  type RemoteSessionKey,
  type RemoteSessionPool,
} from "@/modules/remote/sessionPool";
import { sameRemoteSessionConnection } from "@/modules/remote/sessionConnectionIdentity";
import {
  assertSupportedOpenCodeVersion,
  parseOpenCodeVersion,
} from "@/modules/harness/lib/harness/opencodeProtocol";
import {
  closeRemoteWorkspace,
  closeRemoteTunnel,
  openRemoteTunnel,
  openRemoteWorkspace,
  type RemoteSessionInfo,
  type RemoteSshConnection,
  RemoteTunnelCleanupPendingError,
  runRemoteOpenCodeServiceAction,
} from "@/modules/remote/client";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SshConnection } from "@/modules/ssh/types";

export type RemoteOpenCodeService = {
  url: string;
  password: string;
  directory: string;
  sessionId: number;
};

type OpenDependencies = {
  machineFor: (environmentId: string) => Promise<RemoteMachine | undefined>;
  sshConnections: () => SshConnection[];
  openWorkspace: typeof openRemoteWorkspace;
  openTunnel: typeof openRemoteTunnel;
  serviceAction: typeof runRemoteOpenCodeServiceAction;
  closeWorkspace: typeof closeRemoteWorkspace;
  closeTunnel: typeof closeRemoteTunnel;
  sessions: Pick<
    RemoteSessionPool,
    "acquire" | "snapshot" | "closeSession" | "invalidate"
  >;
  projectFor: typeof remoteProjectForPath;
  projectEnv: (projectId: string) => HarnessRemoteEnv;
};

type ProfileTarget = {
  key: RemoteSessionKey;
  connection: Readonly<RemoteSshConnection>;
};

type ServiceResource = {
  service: RemoteOpenCodeService;
  close: () => Promise<void>;
  isLive: () => boolean;
};

type Entry = {
  owners: Set<string>;
  resource: Promise<ServiceResource>;
  target?: ProfileTarget;
  isLive?: () => boolean;
  closing: boolean;
  cleanup?: () => Promise<void>;
  closeAttempt?: Promise<void>;
};

function retryableCleanup(action: () => Promise<void>): () => Promise<void> {
  let attempt: Promise<void> | undefined;
  return () => {
    if (attempt) return attempt;
    const pending = Promise.resolve().then(action);
    attempt = pending;
    void pending.catch(() => {
      if (attempt === pending) attempt = undefined;
    });
    return pending;
  };
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

function profileTargetFor(
  path: string,
  environmentId: string,
  cwd: string,
  dependencies: OpenDependencies,
): ProfileTarget | undefined {
  const project = dependencies.projectFor(path);
  if (
    project &&
    (project.environmentId !== environmentId ||
      relativeWithinProject(project.cwd, cwd) === undefined)
  ) {
    throw new Error("Remote OpenCode path is outside a saved project.");
  }
  const root = project?.cwd ?? cwd;
  let profile = findSshProfile(environmentId, dependencies.sshConnections(), {
    kind: "local",
  });
  if (!profile) {
    const projectId = remoteProjectKey(environmentId, root);
    const scoped = dependencies.projectEnv(projectId);
    if (
      scoped.kind === "ssh" &&
      scoped.sessionId !== undefined &&
      remoteProjectKey(environmentId, scoped.root) === projectId &&
      relativeWithinProject(scoped.root, cwd) !== undefined
    ) {
      profile = findSshProfile(environmentId, [scoped.connection], {
        kind: "local",
      });
    }
  }
  if (!profile) {
    if (
      environmentId.startsWith("voktty-ssh-") ||
      remoteSshConnectionIdForEnvironment(environmentId)
    ) {
      throw new Error("The saved SSH connection for this project is missing.");
    }
    return undefined;
  }
  return {
    key: { profileId: profile.id, root },
    connection: Object.freeze(remoteSshConnectionForProfile(profile)),
  };
}

async function openService(
  cwd: string,
  environmentId: string,
  dependencies: OpenDependencies,
  target: ProfileTarget | undefined,
  cancelled: () => boolean,
  captureCleanup: (close: () => Promise<void>) => void,
): Promise<ServiceResource> {
  if (cancelled())
    throw new Error("Remote OpenCode service was closed before it was ready.");
  const lease = target
    ? await dependencies.sessions.acquire(target.key, target.connection)
    : undefined;
  let session: RemoteSessionInfo;
  if (lease) {
    session = lease.info;
  } else {
    const machine = await dependencies.machineFor(environmentId);
    if (!machine) throw new Error("The remote machine is no longer connected.");
    if (cancelled())
      throw new Error(
        "Remote OpenCode service was closed before it was ready.",
      );
    session = await dependencies.openWorkspace(
      remoteSshConnectionFor(machine, dependencies.sshConnections()),
      cwd,
    );
  }
  const isLive = () =>
    !target ||
    dependencies.sessions
      .snapshot()
      .some(
        (entry) =>
          entry.key.profileId === target.key.profileId &&
          entry.key.root === target.key.root &&
          entry.sessionId === session.session_id &&
          entry.leases > 0,
      );
  let tunnelId: number | undefined;
  let leaseReleased = false;
  const close = retryableCleanup(async () => {
    if (tunnelId !== undefined) {
      await dependencies.closeTunnel(session.session_id, tunnelId);
      tunnelId = undefined;
    }
    if (lease?.releaseAndClose) {
      await lease.releaseAndClose();
    } else if (lease) {
      if (!leaseReleased) {
        leaseReleased = true;
        lease.release();
      }
      const entry = dependencies.sessions
        .snapshot()
        .find((candidate) => candidate.sessionId === session.session_id);
      if (entry?.leases === 0)
        await dependencies.sessions.closeSession(session.session_id);
    } else {
      await dependencies.closeWorkspace(session.session_id);
    }
  });
  captureCleanup(close);
  const assertReady = () => {
    if (cancelled() || !isLive())
      throw new Error(
        "Remote OpenCode service was closed before it was ready.",
      );
  };
  const action: OpenDependencies["serviceAction"] = async (
    id,
    name,
    directory,
  ) => {
    assertReady();
    try {
      const output = await dependencies.serviceAction(id, name, directory);
      assertReady();
      return output;
    } catch (error) {
      if (target && isSessionLostError(error))
        dependencies.sessions.invalidate(target.key, session.session_id);
      throw error;
    }
  };
  const optionalAction = async (name: "status" | "start") => {
    try {
      return await action(session.session_id, name, cwd);
    } catch (error) {
      if (isSessionLostError(error)) throw error;
      assertReady();
      return "";
    }
  };
  try {
    assertReady();
    const versionOutput = await action(session.session_id, "version", cwd);
    const version = parseOpenCodeVersion(versionOutput);
    const generation = assertSupportedOpenCodeVersion(version);
    if (generation !== "v2") {
      throw new Error(
        "Remote Harness sessions require OpenCode 2.0.15 or newer.",
      );
    }

    let output = await optionalAction("status");
    let remotePort = remoteServicePort(output);
    if (!remotePort) {
      output = await optionalAction("start");
      remotePort = remoteServicePort(output);
    }
    if (!remotePort) {
      output = await optionalAction("status");
      remotePort = remoteServicePort(output);
    }
    if (!remotePort) {
      throw new Error(
        "Remote OpenCode did not report its loopback service port.",
      );
    }

    const password = (await action(session.session_id, "password", cwd)).trim();
    if (!password)
      throw new Error("Remote OpenCode did not report a service password.");

    const tunnel = await dependencies
      .openTunnel(session.session_id, remotePort)
      .catch((error: unknown) => {
        if (
          error instanceof RemoteTunnelCleanupPendingError &&
          error.sessionId === session.session_id
        )
          tunnelId = error.tunnelId;
        throw error;
      });
    tunnelId = tunnel.tunnelId;
    assertReady();
    return {
      service: {
        url: `http://127.0.0.1:${tunnel.localPort}`,
        password,
        directory: cwd,
        sessionId: session.session_id,
      },
      close,
      isLive,
    };
  } catch (error) {
    if (target && isSessionLostError(error))
      dependencies.sessions.invalidate(target.key, session.session_id);
    throw error;
  }
}

export function createRemoteOpenCodeServiceManager(
  dependencies: OpenDependencies,
  maxSessions = 8,
) {
  const entries = new Map<string, Entry>();
  const ownerKeys = new Map<string, string>();
  const ownerLocations = new Map<string, string>();
  const ownerAttempts = new Map<string, object>();
  const ownersNeedingFreshService = new Set<string>();
  const freshServiceKeys = new Map<string, string>();
  let freshServiceSequence = 0;

  const retiredOwners = new Map<string, Map<Entry, string>>();
  const retainRetiredOwner = (owner: string, key: string, entry: Entry) => {
    let retired = retiredOwners.get(owner);
    if (!retired) {
      retired = new Map();
      retiredOwners.set(owner, retired);
    }
    retired.set(entry, key);
  };
  const forgetRetiredOwner = (owner: string, entry: Entry) => {
    const retired = retiredOwners.get(owner);
    retired?.delete(entry);
    if (retired?.size === 0) retiredOwners.delete(owner);
  };
  const finishEntry = (key: string, entry: Entry) => {
    if (entries.get(key) === entry) entries.delete(key);
    for (const owner of retiredOwners.keys()) forgetRetiredOwner(owner, entry);
  };

  const closeEntry = (key: string, entry: Entry): Promise<void> => {
    if (entry.closeAttempt) return entry.closeAttempt;
    entry.closing = true;
    const pending = Promise.resolve().then(async () => {
      await entry.resource.catch(() => undefined);
      await entry.cleanup?.();
      finishEntry(key, entry);
    });
    entry.closeAttempt = pending;
    void pending.catch(() => {
      if (entry.closeAttempt === pending) entry.closeAttempt = undefined;
    });
    return pending;
  };

  const detach = async (ownerId: string): Promise<void> => {
    const key = ownerKeys.get(ownerId);
    ownerKeys.delete(ownerId);
    ownerLocations.delete(ownerId);
    if (!key) return;
    const entry = entries.get(key);
    if (!entry) return;
    entry.owners.delete(ownerId);
    if (entry.owners.size === 0) {
      retainRetiredOwner(ownerId, key, entry);
      await closeEntry(key, entry);
    }
  };

  const captureRelease = (ownerId: string): (() => Promise<void>) => {
    const owner = ownerId;
    const key = ownerKeys.get(owner);
    const entry = key ? entries.get(key) : undefined;
    const captured = new Map<Entry, string>();
    if (key) {
      if (entry) captured.set(entry, key);
    } else {
      for (const [retired, retiredKey] of retiredOwners.get(owner) ?? [])
        captured.set(retired, retiredKey);
    }
    // Retire before the caller awaits abort, so a late acquisition cannot publish.
    ownerAttempts.delete(owner);
    ownerKeys.delete(owner);
    ownerLocations.delete(owner);
    ownersNeedingFreshService.delete(owner);
    freshServiceKeys.delete(owner);
    for (const [resource, resourceKey] of captured) {
      resource.owners.delete(owner);
      if (resource.owners.size === 0)
        retainRetiredOwner(owner, resourceKey, resource);
    }
    return retryableCleanup(async () => {
      const results = await Promise.allSettled(
        [...captured].map(async ([resource, resourceKey]) => {
          if (resource.owners.size === 0)
            await closeEntry(resourceKey, resource);
          else forgetRetiredOwner(owner, resource);
        }),
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    });
  };

  const release = (ownerId: string): Promise<void> => captureRelease(ownerId)();

  const invalidate = async (ownerId: string): Promise<void> => {
    ownerAttempts.delete(ownerId);
    if (!ownerKeys.has(ownerId)) return;
    ownersNeedingFreshService.add(ownerId);
    freshServiceKeys.delete(ownerId);
    await detach(ownerId);
  };

  const acquire = async (
    ownerId: string,
    cwd: string,
  ): Promise<RemoteOpenCodeService | undefined> => {
    const remote = parseRemotePath(cwd);
    if (!remote) {
      if (cwd.startsWith("remote://"))
        throw new Error("Remote OpenCode path is invalid.");
      return undefined;
    }
    const owner = ownerId;
    if (!owner.trim())
      throw new Error("Remote OpenCode session id is required.");
    const target = profileTargetFor(
      cwd,
      remote.environmentId,
      remote.hostPath,
      dependencies,
    );
    const previousAttempt = ownerAttempts.get(owner);
    const attempt = {};
    ownerAttempts.set(owner, attempt);
    const isCurrent = () => ownerAttempts.get(owner) === attempt;
    const rejectAdmission = () => {
      if (!isCurrent()) return;
      if (previousAttempt && ownerKeys.has(owner))
        ownerAttempts.set(owner, previousAttempt);
      else ownerAttempts.delete(owner);
    };
    const location = JSON.stringify([
      remote.environmentId,
      remote.hostPath,
      target?.key.profileId,
      target?.key.root,
    ]);
    if (ownerKeys.has(owner) && ownerLocations.get(owner) !== location) {
      ownersNeedingFreshService.delete(owner);
      freshServiceKeys.delete(owner);
      await detach(owner);
      if (!isCurrent())
        throw new Error(
          "Remote OpenCode service was closed before it was ready.",
        );
    }

    let entryKey = ownerKeys.get(owner);
    let entry = entryKey ? entries.get(entryKey) : undefined;
    if (entry?.closing) {
      await closeEntry(entryKey ?? location, entry);
      if (!isCurrent())
        throw new Error(
          "Remote OpenCode service was closed before it was ready.",
        );
      return acquire(owner, cwd);
    }
    if (!entry) {
      entryKey = ownersNeedingFreshService.has(owner)
        ? (freshServiceKeys.get(owner) ??
          JSON.stringify([location, owner, ++freshServiceSequence]))
        : location;
      if (ownersNeedingFreshService.has(owner)) {
        freshServiceKeys.set(owner, entryKey);
      }
      entry = entries.get(entryKey);
      if (entry?.closing) {
        await closeEntry(entryKey ?? location, entry);
        if (!isCurrent())
          throw new Error(
            "Remote OpenCode service was closed before it was ready.",
          );
        return acquire(owner, cwd);
      }
    }
    if (!entry) {
      if (entries.size >= maxSessions) {
        rejectAdmission();
        throw new Error(
          "Close an unused remote OpenCode session before opening another machine.",
        );
      }
      const createdEntry: Entry = {
        owners: new Set(),
        resource: Promise.resolve().then(() =>
          openService(
            remote.hostPath,
            remote.environmentId,
            dependencies,
            target,
            () => createdEntry.closing,
            (close) => {
              createdEntry.cleanup = close;
            },
          ),
        ),
        target,
        closing: false,
      };
      const createdKey = entryKey;
      if (!createdKey)
        throw new Error("Remote OpenCode service key is missing.");
      entry = createdEntry;
      entries.set(createdKey, entry);
      void entry.resource.then(
        (resource) => {
          createdEntry.isLive = resource.isLive;
        },
        () => undefined,
      );
    }
    if (
      entry.isLive?.() !== false &&
      entry.target &&
      target &&
      !sameRemoteSessionConnection(entry.target.connection, target.connection)
    ) {
      rejectAdmission();
      throw new RemoteSessionConnectionChangedError();
    }
    entry.owners.add(owner);
    ownerKeys.set(owner, entryKey ?? location);
    ownerLocations.set(owner, location);
    try {
      const resource = await entry.resource;
      if (!isCurrent() || entry.closing || ownerKeys.get(owner) !== entryKey) {
        throw new Error(
          "Remote OpenCode service was closed before it was ready.",
        );
      }
      if (!resource.isLive()) {
        await closeEntry(entryKey ?? location, entry);
        if (!isCurrent())
          throw new Error(
            "Remote OpenCode service was closed before it was ready.",
          );
        return acquire(owner, cwd);
      }
      ownersNeedingFreshService.delete(owner);
      freshServiceKeys.delete(owner);
      return resource.service;
    } catch (error) {
      if (isCurrent() && ownerKeys.get(owner) === entryKey) {
        await detach(owner).catch(() => undefined);
        if (isCurrent()) {
          freshServiceKeys.delete(owner);
          ownerAttempts.delete(owner);
        }
      }
      throw error;
    }
  };

  return { acquire, release, captureRelease, invalidate };
}

const remoteOpenCodeServices = createRemoteOpenCodeServiceManager({
  machineFor: remoteMachineFor,
  sshConnections: () => usePreferencesStore.getState().sshConnections ?? [],
  openWorkspace: openRemoteWorkspace,
  openTunnel: openRemoteTunnel,
  serviceAction: runRemoteOpenCodeServiceAction,
  closeWorkspace: closeRemoteWorkspace,
  closeTunnel: closeRemoteTunnel,
  sessions: remoteSessions,
  projectFor: remoteProjectForPath,
  projectEnv: (projectId) =>
    harnessProjectEnvironmentFor(
      projectId,
      useHarnessProjectEnvStore.getState().projects,
    ).env,
});

export const acquireRemoteOpenCodeService = remoteOpenCodeServices.acquire;
export const releaseRemoteOpenCodeService = remoteOpenCodeServices.release;
export const captureRemoteOpenCodeServiceRelease =
  remoteOpenCodeServices.captureRelease;
export const invalidateRemoteOpenCodeService =
  remoteOpenCodeServices.invalidate;
