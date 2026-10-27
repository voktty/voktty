import { create } from "zustand";
import type { SshConnection } from "@/modules/ssh";
import { remoteSessions } from "@/modules/remote/sessionManager";
import {
  isRemoteSessionAdmissionError,
  type RemoteSessionLease,
} from "@/modules/remote/sessionPool";
import { sameRemoteSessionConnection } from "@/modules/remote/sessionConnectionIdentity";
import { isConnectionPending } from "@/modules/connections/lifecycle";
import { remoteSshConnectionForProfile } from "@/modules/connections/model/remoteSshProfiles";
import {
  projectEnvironmentId as harnessProjectEnvironmentId,
  projectEnvironmentOwnerId,
  projectEnvironmentOwnerIds,
  type ProjectEnvironmentIdentity,
} from "./projectEnvironmentIdentity";
import {
  MAX_PROJECT_ENVIRONMENT_OWNERS,
  ProjectEnvironmentCancelledError,
  ProjectEnvironmentCapacityError,
  ProjectEnvironmentRegistry,
} from "./projectEnvironmentRegistry";

export type HarnessRemoteEnv =
  | { kind: "local" }
  | {
      kind: "ssh";
      connection: SshConnection;
      root: string;
      sessionId?: number;
    };

export type HarnessProjectEnvironment = {
  env: HarnessRemoteEnv;
  connecting: boolean;
  error: string | null;
};

export type HarnessProjectEnvironmentEntry = HarnessProjectEnvironment & {
  identity: ProjectEnvironmentIdentity;
};

type HarnessProjectEnvState = {
  projects: Record<string, HarnessProjectEnvironmentEntry>;
  connect: (
    profile: SshConnection,
    targetRoot?: string,
    projectId?: string,
  ) => Promise<HarnessRemoteEnv>;
  disconnect: (projectId: string) => Promise<void>;
  disconnectProfiles: (profileIds: ReadonlySet<string>) => Promise<void>;
  disconnectAll: () => Promise<void>;
  reconnect: (
    profile: SshConnection,
    targetRoot?: string,
    projectId?: string,
  ) => Promise<HarnessRemoteEnv>;
};

const LOCAL_ENV: HarnessRemoteEnv = { kind: "local" };
const profiles = new Map<string, SshConnection>();
const automaticOwners = new Set<string>();
const projectIds = new Map<string, string>();
const detachedFailures = new Map<string, HarnessProjectEnvironmentEntry>();
const EMPTY_PROJECT_ENVIRONMENT: HarnessProjectEnvironment = {
  env: LOCAL_ENV,
  connecting: false,
  error: null,
};
const requests = new Map<string, object>();
const pending = new Map<
  string,
  {
    profileId: string;
    root: string;
    promise: Promise<HarnessRemoteEnv>;
  }
>();

async function releaseProjectLease(lease: RemoteSessionLease): Promise<void> {
  lease.release();
  const entry = remoteSessions
    .snapshot()
    .find((candidate) => candidate.sessionId === lease.info.session_id);
  if (entry?.leases === 0) {
    await remoteSessions.closeSession(lease.info.session_id);
  }
}

const environments = new ProjectEnvironmentRegistry({
  acquire: (target) =>
    remoteSessions.acquire(
      { profileId: target.profileId, root: target.root },
      target.connection,
    ),
  release: releaseProjectLease,
});

export { harnessProjectEnvironmentId };

export function harnessProjectEnvironmentFor(
  projectId: string | null,
  projects: Readonly<Record<string, HarnessProjectEnvironmentEntry>>,
): HarnessProjectEnvironment {
  const ownerId =
    projectId === null
      ? undefined
      : projectEnvironmentOwnerId(projectId, projects);
  return ownerId === undefined ? EMPTY_PROJECT_ENVIRONMENT : projects[ownerId];
}

function refreshProjects() {
  const projects: Record<string, HarnessProjectEnvironmentEntry> =
    Object.create(null);
  for (const snapshot of environments.snapshot()) {
    const profile = profiles.get(snapshot.ownerId);
    if (!profile) continue;
    const automatic = automaticOwners.has(snapshot.ownerId);
    const projectId =
      detachedFailures.get(snapshot.ownerId)?.identity.projectId ??
      (automatic && snapshot.session
        ? harnessProjectEnvironmentId(
            snapshot.profileId,
            snapshot.session.workspace_root,
          )
        : (projectIds.get(snapshot.ownerId) ?? snapshot.projectId));
    projectIds.set(snapshot.ownerId, projectId);
    projects[snapshot.projectId] = {
      identity: {
        projectId,
        profileId: snapshot.profileId,
        requestedRoot: snapshot.requestedRoot,
        resolvedRoot: snapshot.session?.workspace_root,
        automatic,
      },
      env: snapshot.session
        ? {
            kind: "ssh",
            connection: profile,
            root: snapshot.session.workspace_root,
            sessionId: snapshot.session.session_id,
          }
        : LOCAL_ENV,
      connecting: isConnectionPending(snapshot.state),
      error: snapshot.state.error,
    };
  }
  for (const [ownerId, failure] of detachedFailures) {
    if (!Object.getOwnPropertyDescriptor(projects, ownerId))
      projects[ownerId] = failure;
  }
  useHarnessProjectEnvStore.setState({ projects });
}

async function connectProject(
  inputProfile: SshConnection,
  targetRoot?: string,
  explicitProjectId?: string,
  force = false,
): Promise<HarnessRemoteEnv> {
  const profile = Object.freeze({ ...inputProfile });
  const candidateRoot = targetRoot?.trim();
  let root =
    candidateRoot && candidateRoot !== "~"
      ? candidateRoot
      : profile.initialDirectory?.trim() || ".";
  const requestedProjectId =
    explicitProjectId ?? harnessProjectEnvironmentId(profile.id, root);
  const automatic =
    explicitProjectId === undefined ||
    requestedProjectId === harnessProjectEnvironmentId(profile.id, root);
  const connection = remoteSshConnectionForProfile(profile);
  const projects = useHarnessProjectEnvStore.getState().projects;
  const alias = projectEnvironmentOwnerId(requestedProjectId, projects);
  const aliasEntry = alias === undefined ? undefined : projects[alias];
  const aliasProfile = alias === undefined ? undefined : profiles.get(alias);
  const matchingAlias =
    aliasEntry?.identity.automatic &&
    aliasEntry.identity.profileId === profile.id &&
    aliasProfile &&
    ((alias !== undefined && detachedFailures.has(alias)) ||
      sameRemoteSessionConnection(
        remoteSshConnectionForProfile(aliasProfile),
        connection,
      ));
  const projectId =
    alias === requestedProjectId || matchingAlias
      ? (alias ?? requestedProjectId)
      : requestedProjectId;
  if (!projectId.trim() || projectId.length > 65536) {
    return Promise.reject(new Error("The project identity is invalid."));
  }
  if (
    !profiles.has(projectId) &&
    profiles.size >= MAX_PROJECT_ENVIRONMENT_OWNERS
  ) {
    return Promise.reject(
      new Error("Too many remote project environments are open."),
    );
  }
  const cached = environments
    .snapshot()
    .find((entry) => entry.ownerId === projectId);
  const stale =
    cached?.state.phase === "ready" &&
    !remoteSessions
      .snapshot()
      .some(
        (entry) =>
          entry.sessionId === cached.session?.session_id &&
          entry.key.profileId === cached.profileId &&
          entry.leases > 0 &&
          entry.state.phase === "ready",
      );
  const replace = force || stale;
  if (matchingAlias && cached?.session) {
    root = replace ? cached.session.workspace_root : cached.requestedRoot;
  }
  const previous = pending.get(projectId);
  if (
    !replace &&
    previous?.profileId === profile.id &&
    previous.root === root &&
    aliasProfile !== undefined &&
    sameRemoteSessionConnection(
      remoteSshConnectionForProfile(aliasProfile),
      connection,
    )
  ) {
    return previous.promise;
  }
  const token = {};
  const target = { projectId, profileId: profile.id, root, connection };
  const consume = async (
    source: Promise<RemoteSessionLease["info"]>,
  ): Promise<HarnessRemoteEnv> => {
    try {
      const session = await source.catch((reason) => {
        if (
          requests.get(projectId) !== token ||
          reason instanceof ProjectEnvironmentCancelledError ||
          reason instanceof ProjectEnvironmentCapacityError ||
          isRemoteSessionAdmissionError(reason) ||
          root === "."
        ) {
          throw reason;
        }
        return environments.connect(projectId, { ...target, root: "." });
      });
      if (requests.get(projectId) !== token) {
        throw new ProjectEnvironmentCancelledError();
      }
      return {
        kind: "ssh",
        connection: profile,
        root: session.workspace_root,
        sessionId: session.session_id,
      };
    } catch (reason) {
      if (
        requests.get(projectId) === token &&
        !environments.snapshot().some((entry) => entry.ownerId === projectId)
      ) {
        pending.delete(projectId);
        requests.delete(projectId);
        profiles.delete(projectId);
        automaticOwners.delete(projectId);
        projectIds.delete(projectId);
      }
      throw reason;
    } finally {
      if (requests.get(projectId) === token) pending.delete(projectId);
    }
  };
  let operation: Promise<HarnessRemoteEnv> | undefined;
  const source = environments.connect(
    projectId,
    target,
    replace,
    (admitted) => {
      requests.set(projectId, token);
      profiles.set(projectId, profile);
      if (automatic) automaticOwners.add(projectId);
      else automaticOwners.delete(projectId);
      projectIds.set(projectId, automatic ? requestedProjectId : projectId);
      operation = consume(admitted);
      pending.set(projectId, {
        profileId: profile.id,
        root,
        promise: operation,
      });
      refreshProjects();
    },
  );
  return operation ?? consume(source);
}

async function disconnectOwners(ids: string[]): Promise<void> {
  const owners = new Set(ids);
  const captured = useHarnessProjectEnvStore.getState().projects;
  for (const id of owners) {
    requests.delete(id);
    pending.delete(id);
  }
  const releasing = environments.releaseOwners(owners);
  try {
    await releasing;
  } catch (reason) {
    for (const id of owners) {
      if (!requests.has(id) && Object.getOwnPropertyDescriptor(captured, id)) {
        detachedFailures.set(id, {
          ...captured[id],
          env: LOCAL_ENV,
          connecting: false,
          error: "Could not release the project environment.",
        });
      }
    }
    refreshProjects();
    throw reason;
  }
  for (const id of owners) {
    if (!requests.has(id)) {
      profiles.delete(id);
      projectIds.delete(id);
      automaticOwners.delete(id);
      detachedFailures.delete(id);
    }
  }
}

async function disconnectProject(projectId: string): Promise<void> {
  if (
    typeof projectId !== "string" ||
    !projectId.trim() ||
    projectId.length > 65536
  ) {
    throw new Error("The project identity is invalid.");
  }
  const projects = useHarnessProjectEnvStore.getState().projects;
  const owners = projectEnvironmentOwnerIds(projectId, projects);
  await disconnectOwners(owners.length ? owners : [projectId]);
}

export const useHarnessProjectEnvStore = create<HarnessProjectEnvState>(() => ({
  projects: {},
  connect: connectProject,
  disconnect: disconnectProject,
  reconnect: (profile, root, projectId) =>
    connectProject(profile, root, projectId, true),
  disconnectProfiles: async (profileIds) => {
    const ids = [...profiles.entries()]
      .filter(([, profile]) => profileIds.has(profile.id))
      .map(([ownerId]) => ownerId);
    await disconnectOwners(ids);
  },
  disconnectAll: async () => {
    const ids = [...profiles.keys()];
    await disconnectOwners(ids);
  },
}));

environments.subscribe(refreshProjects);
