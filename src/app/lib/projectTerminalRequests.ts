import type { WorkspaceEnv } from "@/modules/workspace";
import type {
  ProjectTerminalTarget,
  SshMultiplexerPicker,
} from "@/modules/harness/lib/projectTerminalTarget";
import {
  ownedPtyTargets,
  type OwnedPtyTarget,
  type OwnedPtyTargetReceipt,
} from "@/modules/terminal/lib/ownedPtyTargets";
import { terminalRestoreCwd } from "@/modules/tabs/lib/terminalProjectRestore";
import { terminalProjectMetadata } from "@/modules/tabs/lib/terminalProject";

export type CreatedProjectTerminal = Readonly<{
  tabId: number;
  leafId: number;
}>;
export type ProjectTerminalOpenOptions = {
  projectCwd?: string;
  isCurrent?: () => boolean;
  onCreated?: (created: CreatedProjectTerminal) => void;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
};

type Request = {
  owner: object;
  release?: () => Promise<void>;
  cleaning?: Promise<void>;
  cancelPicker: () => void;
  needsCleanup?: boolean;
};
const requests = new Set<Request>();

export type ProjectTerminalRequestContext = {
  isCurrent: () => boolean;
  create: (
    cwd: string | undefined,
    workspace: WorkspaceEnv,
  ) => { tabId: number; leafId: number };
  rollback: (tabId: number) => void;
  pick: (
    owner: object,
    ...args: Parameters<SshMultiplexerPicker>
  ) => ReturnType<SshMultiplexerPicker>;
  cancelPicker: (owner: object) => void;
  onError: (error: unknown) => void;
};

function clean(request: Request): Promise<void> {
  if (request.cleaning) return request.cleaning;
  const pending = Promise.resolve().then(async () => {
    await request.release?.();
    requests.delete(request);
  });
  request.cleaning = pending;
  void pending.catch(() => {
    if (request.cleaning === pending) request.cleaning = undefined;
  });
  return pending;
}

function ownedTarget(target: ProjectTerminalTarget): OwnedPtyTarget {
  const lease = target.lease;
  const acquire = target.acquireSibling;
  return {
    cwd: target.cwd,
    workspace: target.workspace,
    release: () => {
      if (lease.releaseAndClose) return lease.releaseAndClose();
      lease.release();
      return Promise.resolve();
    },
    acquireSibling: acquire
      ? async (cwd) => ownedTarget(await acquire(cwd))
      : undefined,
  };
}

export function createProjectTerminalRequests(deps: {
  capture: () => ProjectTerminalRequestContext;
  resolve: (
    cwd: string,
    picker: SshMultiplexerPicker,
    isCurrent: () => boolean,
  ) => Promise<ProjectTerminalTarget | undefined>;
  register?: (leafId: number, target: OwnedPtyTarget) => OwnedPtyTargetReceipt;
}) {
  const owner = {};
  let live = true;
  const retryCleanup = () => {
    ownedPtyTargets.retryCleanup();
    for (const request of requests) {
      if (request.needsCleanup && !request.cleaning)
        void clean(request).catch(() => undefined);
    }
  };
  return {
    open: async (
      cwd: unknown,
      input: ProjectTerminalOpenOptions = {},
    ): Promise<CreatedProjectTerminal | undefined> => {
      const options = { ...input };
      const context = { ...deps.capture() };
      const isCurrent = () =>
        live &&
        context.isCurrent() &&
        (options.isCurrent?.() ?? true) &&
        !options.signal?.aborted;
      const onError = options.onError ?? context.onError;
      if (!isCurrent()) return;
      if (
        cwd !== undefined &&
        (typeof cwd !== "string" || cwd.length > 32768 || cwd.includes("\0"))
      ) {
        onError(new Error("Invalid terminal folder."));
        return;
      }
      const project = options.projectCwd;
      if (
        project !== undefined &&
        !terminalProjectMetadata(project).projectCwd
      ) {
        onError(new Error("Invalid terminal project."));
        return;
      }
      const remoteProject = project?.startsWith("remote://")
        ? project
        : undefined;
      if (
        project !== undefined &&
        !remoteProject &&
        cwd !== undefined &&
        !terminalProjectMetadata(cwd).projectCwd
      ) {
        onError(new Error("Invalid terminal folder."));
        return;
      }
      if (
        project !== undefined &&
        !remoteProject &&
        typeof cwd === "string" &&
        cwd.startsWith("remote://")
      ) {
        onError(new Error("Terminal folder belongs to another connection."));
        return;
      }
      let folder: string | undefined;
      try {
        folder = remoteProject
          ? terminalRestoreCwd(remoteProject, cwd)
          : (cwd ?? project);
      } catch (error) {
        if (isCurrent()) onError(error);
        return;
      }
      if (
        !remoteProject &&
        (typeof cwd !== "string" || !cwd.startsWith("remote://"))
      ) {
        const created = Object.freeze({
          ...context.create(folder, { kind: "local" }),
        });
        try {
          if (!isCurrent()) {
            context.rollback(created.tabId);
            return;
          }
          options.onCreated?.(created);
          return created;
        } catch (error) {
          context.rollback(created.tabId);
          if (isCurrent()) onError(error);
          return;
        }
      }
      const destination = remoteProject ?? cwd;
      if (typeof destination !== "string") return;
      retryCleanup();
      if (requests.size + ownedPtyTargets.size() >= 256) {
        onError(new Error("Terminal request limit reached."));
        return;
      }
      const request: Request = {
        owner,
        cancelPicker: () => context.cancelPicker(request),
      };
      requests.add(request);
      options.signal?.addEventListener("abort", request.cancelPicker, {
        once: true,
      });
      let cancelled = false;
      let error: unknown;
      let failed = false;
      let accepted: CreatedProjectTerminal | undefined;
      try {
        const target = await deps.resolve(
          destination,
          async (...args) => {
            if (!isCurrent()) {
              cancelled = true;
              return null;
            }
            const selection = await context.pick(request, ...args);
            if (!selection) cancelled = true;
            return isCurrent() ? selection : null;
          },
          isCurrent,
        );
        if (!target)
          throw new Error("Remote terminal destination is unavailable.");
        const owned = ownedTarget(target);
        request.release = owned.release;
        if (isCurrent()) {
          const created = Object.freeze({
            ...context.create(
              remoteProject ? folder : target.cwd,
              target.workspace,
            ),
          });
          if (remoteProject) owned.cwd = folder ?? target.cwd;
          let receipt: OwnedPtyTargetReceipt | undefined;
          try {
            if (!isCurrent()) throw new Error("Terminal request was retired.");
            receipt = (deps.register ?? ownedPtyTargets.register)(
              created.leafId,
              owned,
            );
            request.release = undefined;
            if (!isCurrent()) throw new Error("Terminal request was retired.");
            options.onCreated?.(created);
            accepted = created;
          } catch (reason) {
            if (receipt) request.release = receipt.dispose;
            context.rollback(created.tabId);
            throw reason;
          }
        }
      } catch (reason) {
        error = reason;
        failed = true;
      }
      try {
        if (request.release) {
          request.needsCleanup = true;
          await clean(request);
        } else requests.delete(request);
      } catch (reason) {
        if (!failed) error = reason;
        failed = true;
      }
      options.signal?.removeEventListener("abort", request.cancelPicker);
      if (failed && !cancelled && isCurrent()) onError(error);
      return accepted;
    },
    retireSelection: () => {
      for (const request of requests)
        if (request.owner === owner) request.cancelPicker();
    },
    dispose: () => {
      live = false;
      for (const request of requests)
        if (request.owner === owner) request.cancelPicker();
      retryCleanup();
    },
    retryCleanup,
    pendingCount: () => requests.size,
  };
}
