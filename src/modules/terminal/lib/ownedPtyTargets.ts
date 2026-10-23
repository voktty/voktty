import type { WorkspaceEnv } from "@/modules/workspace";
import type {
  PtyHandlers,
  PtySession,
} from "@/modules/terminal/lib/pty-bridge";

export type OwnedPtyTarget = {
  cwd: string;
  workspace: Extract<WorkspaceEnv, { kind: "ssh" }>;
  release: () => Promise<void>;
  acquireSibling?: (cwd: string) => Promise<OwnedPtyTarget>;
};

export type OwnedPtyTargetReceipt = {
  isCurrent: () => boolean;
  open: (
    start: (
      target: Pick<OwnedPtyTarget, "cwd" | "workspace">,
      handlers: PtyHandlers,
    ) => Promise<PtySession>,
    handlers: PtyHandlers,
  ) => Promise<PtySession>;
  close: () => Promise<void>;
  dispose: () => Promise<void>;
  retryCleanup: () => void;
};

export function createOwnedPtyTargets(limit = 256) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256)
    throw new Error("Invalid terminal resource limit.");
  const entries = new Map<number, OwnedPtyTargetReceipt>();
  const workspaces = new WeakSet<WorkspaceEnv>();
  const siblingFactories = new WeakMap<
    WorkspaceEnv,
    NonNullable<OwnedPtyTarget["acquireSibling"]>
  >();

  function register(
    leafId: number,
    input: OwnedPtyTarget,
    acquire?: () => Promise<OwnedPtyTarget>,
  ): OwnedPtyTargetReceipt {
    if (!Number.isSafeInteger(leafId) || leafId < 0)
      throw new Error("Invalid terminal leaf.");
    if (entries.has(leafId))
      throw new Error("Terminal resource is already owned.");
    if (entries.size >= limit)
      throw new Error("Terminal resource limit reached.");
    if (
      !input.cwd ||
      input.cwd.length > 32768 ||
      input.cwd.includes("\0") ||
      input.cwd.startsWith("remote://")
    )
      throw new Error("Terminal resource requires a resolved folder.");
    const sessionId = input.workspace.sessionId;
    if (
      sessionId === undefined ||
      !Number.isSafeInteger(sessionId) ||
      sessionId < 0
    )
      throw new Error("Terminal resource requires a connected workspace.");
    let target: OwnedPtyTarget = {
      cwd: input.cwd,
      workspace: {
        ...input.workspace,
        connection: { ...input.workspace.connection },
      },
      release: input.release,
      acquireSibling: input.acquireSibling,
    };
    let acquired = !acquire;
    let retired = false;
    let native: PtySession | undefined;
    let opening: Promise<PtySession> | undefined;
    let closing: Promise<void> | undefined;
    let released = false;
    let disposed = false;
    let disposing: Promise<void> | undefined;

    const isCurrent = () => !retired && entries.get(leafId) === receipt;
    const close = (): Promise<void> => {
      retired = true;
      if (closing) return closing;
      const pending = Promise.resolve().then(async () => {
        if (opening) await opening.catch(() => undefined);
        if (native) {
          await native.close();
          native = undefined;
        }
        if (!released) {
          await target.release();
          released = true;
        }
      });
      closing = pending;
      void pending.catch(() => {
        if (closing === pending) closing = undefined;
      });
      return pending;
    };

    const receipt: OwnedPtyTargetReceipt = {
      isCurrent,
      close,
      dispose: () => {
        disposed = true;
        if (disposing) return disposing;
        const pending = close().then(() => {
          if (entries.get(leafId) === receipt) entries.delete(leafId);
        });
        disposing = pending;
        void pending.catch(() => {
          if (disposing === pending) disposing = undefined;
        });
        return pending;
      },
      retryCleanup: () => {
        if (disposed && !disposing)
          void receipt.dispose().catch(() => undefined);
      },
      open: async (start, handlers) => {
        if (!isCurrent()) throw new Error("Terminal resource was retired.");
        if (opening || native)
          throw new Error("Terminal resource is already opening.");
        const pending = Promise.resolve()
          .then(async () => {
            if (!isCurrent()) throw new Error("Terminal resource was retired.");
            if (!acquired && acquire) {
              const resolved = await acquire();
              target = {
                ...resolved,
                workspace: {
                  ...resolved.workspace,
                  connection: { ...resolved.workspace.connection },
                },
              };
              acquired = true;
              markWorkspace(target.workspace, target.acquireSibling);
              if (!isCurrent())
                throw new Error("Terminal resource was retired.");
            }
            return start(
              {
                cwd: target.cwd,
                workspace: {
                  ...target.workspace,
                  connection: { ...target.workspace.connection },
                },
              },
              {
                onData: (data) => {
                  if (isCurrent()) handlers.onData(data);
                },
                onResize: (cols, rows) => {
                  if (isCurrent()) handlers.onResize?.(cols, rows);
                },
                onExit: (code) => {
                  if (!isCurrent()) return;
                  void close().catch(() => undefined);
                  handlers.onExit?.(code);
                },
              },
            );
          })
          .then((session) => {
            native = session;
            return session;
          });
        opening = pending;
        let session: PtySession;
        try {
          session = await pending;
        } finally {
          if (opening === pending) opening = undefined;
        }
        if (!isCurrent()) {
          await close();
          throw new Error("Terminal resource was retired.");
        }
        return {
          id: session.id,
          workspace: target.workspace,
          write: (data) =>
            isCurrent() ? session.write(data) : Promise.resolve(),
          resize: (cols, rows) =>
            isCurrent() ? session.resize(cols, rows) : Promise.resolve(),
          close,
        };
      },
    };
    entries.set(leafId, receipt);
    markWorkspace(input.workspace, input.acquireSibling);
    markWorkspace(target.workspace, target.acquireSibling);
    return receipt;
  }

  function markWorkspace(
    workspace: WorkspaceEnv,
    acquireSibling: OwnedPtyTarget["acquireSibling"],
  ) {
    workspaces.add(workspace);
    if (acquireSibling) siblingFactories.set(workspace, acquireSibling);
  }

  return {
    register,
    claimSibling: (leafId: number, workspace: WorkspaceEnv, cwd?: string) => {
      const factory = siblingFactories.get(workspace);
      if (!factory || workspace.kind !== "ssh") return undefined;
      const folder = cwd ?? workspace.root;
      return register(
        leafId,
        {
          cwd: folder,
          workspace,
          release: async () => {},
          acquireSibling: factory,
        },
        () => factory(folder),
      );
    },
    get: (leafId: number) => entries.get(leafId),
    close: (leafId: number) =>
      entries.get(leafId)?.dispose() ?? Promise.resolve(),
    size: () => entries.size,
    requiresOwnership: (workspace: WorkspaceEnv) => workspaces.has(workspace),
    retryCleanup: () => {
      for (const receipt of entries.values()) receipt.retryCleanup();
    },
  };
}

export const ownedPtyTargets = createOwnedPtyTargets();
