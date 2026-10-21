import { create } from "zustand";
import type { SshConnection } from "@/modules/ssh";
import { closeRemoteWorkspace } from "@/modules/remote/client";
import { remoteSessions } from "@/modules/remote/sessionManager";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";
import { isConnectionPending } from "@/modules/connections/lifecycle";
import { remotePath } from "@/modules/connections/model/remoteProjects";
import {
  remoteSshConnectionForProfile,
  remoteSshEnvironmentId,
} from "@/modules/connections/model/remoteSshProfiles";
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

type HarnessEnvState = HarnessProjectEnvironment & {
  projectId: string | null;
  projects: Record<string, HarnessProjectEnvironment>;
  connect: (
    profile: SshConnection,
    targetRoot?: string,
    projectId?: string,
  ) => Promise<HarnessRemoteEnv>;
  disconnect: (projectId?: string) => Promise<void>;
  disconnectProfiles: (profileIds: ReadonlySet<string>) => Promise<void>;
  disconnectAll: () => Promise<void>;
  reconnect: (
    profile: SshConnection,
    targetRoot?: string,
    projectId?: string,
  ) => Promise<HarnessRemoteEnv>;
  selectProject: (projectId: string | null) => void;
  setEnv: (env: HarnessRemoteEnv) => void;
};

const LOCAL_ENV: HarnessRemoteEnv = { kind: "local" };
const profiles = new Map<string, SshConnection>();
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

export function harnessProjectEnvironmentId(
  profileId: string,
  root: string,
): string {
  return remotePath(remoteSshEnvironmentId(profileId), root);
}

function refreshProjects(selectedProjectId?: string) {
  const projects: Record<string, HarnessProjectEnvironment> =
    Object.create(null);
  for (const snapshot of environments.snapshot()) {
    const profile = profiles.get(snapshot.ownerId);
    if (!profile) continue;
    projects[snapshot.projectId] = {
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
  const selected =
    selectedProjectId ?? useHarnessProjectEnvStore.getState().projectId;
  useHarnessProjectEnvStore.setState({
    projects,
    ...(selectedProjectId !== undefined
      ? { projectId: selectedProjectId }
      : {}),
    ...(selected !== null
      ? (projects[selected] ?? {
          env: LOCAL_ENV,
          connecting: false,
          error: null,
        })
      : {}),
  });
}

async function connectProject(
  profile: SshConnection,
  targetRoot?: string,
  explicitProjectId?: string,
  force = false,
): Promise<HarnessRemoteEnv> {
  const candidateRoot = targetRoot?.trim();
  const root =
    candidateRoot && candidateRoot !== "~"
      ? candidateRoot
      : profile.initialDirectory?.trim() || ".";
  const projectId =
    explicitProjectId ?? harnessProjectEnvironmentId(profile.id, root);
  const connection = remoteSshConnectionForProfile(profile);
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
  const previous = pending.get(projectId);
  if (
    !replace &&
    previous?.profileId === profile.id &&
    previous.root === root
  ) {
    useHarnessProjectEnvStore.getState().selectProject(projectId);
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
        if (useHarnessProjectEnvStore.getState().projectId === projectId) {
          useHarnessProjectEnvStore.setState({
            projectId: null,
            env: LOCAL_ENV,
            connecting: false,
            error:
              reason instanceof Error
                ? reason.message
                : typeof reason === "string"
                  ? reason
                  : "Could not connect the project environment.",
          });
        }
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
      operation = consume(admitted);
      pending.set(projectId, {
        profileId: profile.id,
        root,
        promise: operation,
      });
      refreshProjects(projectId);
    },
  );
  return operation ?? consume(source);
}

async function releaseLegacyEnvironment(env: HarnessRemoteEnv): Promise<void> {
  const current = useHarnessProjectEnvStore.getState();
  if (current.projectId === null && current.env === env) {
    useHarnessProjectEnvStore.getState().selectProject(null);
  }
  if (env.kind !== "ssh" || env.sessionId === undefined) return;
  const sessionId = env.sessionId;
  if (
    !remoteSessions.snapshot().some((entry) => entry.sessionId === sessionId)
  ) {
    await closeRemoteWorkspace(sessionId);
  }
}

async function disconnectProject(projectId?: string): Promise<void> {
  const selected = useHarnessProjectEnvStore.getState();
  const id = projectId ?? selected.projectId;
  if (id !== null) {
    requests.delete(id);
    pending.delete(id);
    const releasing = environments.releaseOwner(id);
    if (useHarnessProjectEnvStore.getState().projectId === id) {
      useHarnessProjectEnvStore.getState().selectProject(null);
    }
    await releasing;
    if (!requests.has(id)) profiles.delete(id);
    return;
  }
  // The breadcrumb still supplies unpooled environments through setEnv until
  // its lease migration. Never close an id owned by another pooled consumer.
  await releaseLegacyEnvironment(selected.env);
}

export const useHarnessProjectEnvStore = create<HarnessEnvState>(
  (set, get) => ({
    env: LOCAL_ENV,
    projectId: null,
    projects: {},
    connecting: false,
    error: null,
    connect: connectProject,
    disconnect: disconnectProject,
    reconnect: (profile, root, projectId) =>
      connectProject(profile, root, projectId, true),
    selectProject: (projectId) => {
      const projects = get().projects;
      const project =
        projectId !== null &&
        Object.getOwnPropertyDescriptor(projects, projectId) !== undefined
          ? projects[projectId]
          : undefined;
      set({
        projectId,
        ...(project ?? { env: LOCAL_ENV, connecting: false, error: null }),
      });
    },
    setEnv: (env) => {
      const managed =
        env.kind === "ssh"
          ? Object.entries(get().projects).find(
              ([, project]) =>
                project.env.kind === "ssh" &&
                project.env.sessionId === env.sessionId &&
                project.env.connection.id === env.connection.id,
            )?.[0]
          : undefined;
      if (managed) get().selectProject(managed);
      else set({ projectId: null, env, connecting: false, error: null });
    },
    disconnectProfiles: async (profileIds) => {
      const ids = environments
        .snapshot()
        .filter((entry) => profileIds.has(entry.profileId))
        .map((entry) => entry.ownerId);
      const selected = get();
      const external =
        selected.projectId === null &&
        selected.env.kind === "ssh" &&
        profileIds.has(selected.env.connection.id);
      await Promise.all(ids.map((id) => disconnectProject(id)));
      if (external) await releaseLegacyEnvironment(selected.env);
    },
    disconnectAll: async () => {
      const selected = get();
      const external =
        selected.projectId === null && selected.env.kind === "ssh";
      const ids = environments.snapshot().map((entry) => entry.ownerId);
      await Promise.all(ids.map((id) => disconnectProject(id)));
      if (external) await releaseLegacyEnvironment(selected.env);
    },
  }),
);

environments.subscribe(refreshProjects);

// Temporary selection facade for consumers not yet migrated to project reads.
export const useHarnessEnvStore = useHarnessProjectEnvStore;
