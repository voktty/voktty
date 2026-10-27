import {
  forgetGuestTerminal,
  isCollabGuestLeaf,
  openCollabGuestPty,
} from "@/modules/collab/lib/guestRuntime";
import { consumeSnapshotBarrier } from "@/modules/terminal/lib/snapshotBarrier";
import { ownedPtyTargets } from "@/modules/terminal/lib/ownedPtyTargets";
import { reserveRestoredProjectTarget } from "@/modules/terminal/lib/restoreProjectTarget";
import { requestRemoteResult } from "@/modules/remote/client";
import {
  currentWorkspaceEnv,
  type WorkspaceEnv,
  workspaceEnvForNativePty,
  workspaceForDocumentPath,
} from "@/modules/workspace";
import { Channel, invoke } from "@tauri-apps/api/core";

const textEncoder = new TextEncoder();
let pendingActivityProbes = 0;

export type PtyHandlers = {
  onData: (bytes: Uint8Array) => void;
  onResize?: (cols: number, rows: number) => void;
  onExit?: (code: number) => void;
};

export type PtySession = {
  id: number;
  workspace?: WorkspaceEnv;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
  inspectActivity?: (kind: "process" | "job") => Promise<boolean>;
};

export async function openPty(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
  blocks?: boolean,
  shell?: string,
  paneId?: number,
  workspace?: WorkspaceEnv,
): Promise<PtySession> {
  const owned =
    paneId === undefined
      ? undefined
      : (ownedPtyTargets.get(paneId) ??
        (workspace && !isCollabGuestLeaf(paneId)
          ? (ownedPtyTargets.claimSibling(paneId, workspace, cwd) ??
            (workspace.kind === "ssh" &&
            workspace.restoredProjectCwd !== undefined
              ? reserveRestoredProjectTarget(
                  paneId,
                  workspace.restoredProjectCwd,
                  cwd,
                )
              : undefined))
          : undefined));
  if (owned && paneId !== undefined) {
    if (isCollabGuestLeaf(paneId))
      throw new Error("Terminal resource has conflicting owners.");
    return owned.open(
      (target, capturedHandlers) =>
        openNativePty(
          cols,
          rows,
          capturedHandlers,
          target.cwd,
          blocks,
          shell,
          paneId,
          target.workspace,
        ),
      handlers,
    );
  }
  if (workspace && ownedPtyTargets.requiresOwnership(workspace)) {
    throw new Error("This terminal requires its own project connection.");
  }
  return openNativePty(
    cols,
    rows,
    handlers,
    cwd,
    blocks,
    shell,
    paneId,
    workspace,
  );
}

async function openNativePty(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
  blocks?: boolean,
  shell?: string,
  paneId?: number,
  workspace?: WorkspaceEnv,
): Promise<PtySession> {
  if (paneId !== undefined && isCollabGuestLeaf(paneId)) {
    return openCollabGuestPty(paneId, handlers);
  }
  if (cwd?.startsWith("remote://")) {
    throw new Error(
      "Resolve the remote project connection before starting a terminal.",
    );
  }
  const activeWorkspace =
    workspace ??
    (cwd
      ? workspaceForDocumentPath(currentWorkspaceEnv(), cwd)
      : currentWorkspaceEnv());
  if (activeWorkspace.kind === "serial") {
    const onData = new Channel<ArrayBuffer>();
    const onExit = new Channel<number>();

    let released = false;
    const noop = () => {};
    const releaseHandlers = () => {
      if (released) return;
      released = true;
      onData.onmessage = noop;
      onExit.onmessage = noop;
    };

    onData.onmessage = (buf) => handlers.onData(new Uint8Array(buf));
    onExit.onmessage = (code) => {
      releaseHandlers();
      handlers.onExit?.(code);
    };

    const id = await invoke<number>("serial_open", {
      options: {
        port_name: activeWorkspace.portName,
        baud_rate: activeWorkspace.baudRate,
        data_bits: activeWorkspace.dataBits,
        flow_control: activeWorkspace.flowControl,
        parity: activeWorkspace.parity,
        stop_bits: activeWorkspace.stopBits,
      },
      onData,
      onExit,
    });

    let closed = false;
    const headers: Record<string, string> = { "x-serial-id": String(id) };

    return {
      id,
      inspectActivity: async () => false,
      write: (data) =>
        invoke("serial_write", textEncoder.encode(data), { headers }),
      resize: async () => {},
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await invoke("serial_close", { id });
        } finally {
          releaseHandlers();
        }
      },
    };
  }

  const remoteWorkspace =
    activeWorkspace.kind === "ssh" ? activeWorkspace : undefined;
  const remoteSessionId = remoteWorkspace?.sessionId;
  if (remoteWorkspace && remoteSessionId === undefined) {
    throw new Error("Remote workspace is not connected");
  }

  // Raw bytes — no base64/JSON round-trip; messages arrive as ArrayBuffer.
  const onData = new Channel<ArrayBuffer>();
  const onExit = new Channel<number>();

  let released = false;
  const noop = () => {};
  const releaseHandlers = () => {
    if (released) return;
    released = true;
    onData.onmessage = noop;
    onExit.onmessage = noop;
  };

  onData.onmessage = (buf) => {
    const bytes = new Uint8Array(buf);
    if (paneId !== undefined && consumeSnapshotBarrier(paneId, bytes)) return;
    handlers.onData(bytes);
  };
  onExit.onmessage = (code) => {
    releaseHandlers();
    handlers.onExit?.(code);
  };

  const sshConnection =
    activeWorkspace.kind === "ssh" ? activeWorkspace.connection : undefined;
  const multiplexerMode = sshConnection?.multiplexerMode;
  const tmuxSessionName =
    sshConnection?.activeMultiplexerSession ?? sshConnection?.tmuxSessionName;
  const multiplexerAction = sshConnection?.multiplexerAction;

  const id =
    remoteSessionId !== undefined
      ? await invoke<number>("remote_pty_open", {
          sessionId: remoteSessionId,
          cols,
          rows,
          cwd: cwd ?? remoteWorkspace?.root,
          blocks: blocks ?? false,
          multiplexerMode: multiplexerMode ?? null,
          tmuxSessionName: tmuxSessionName ?? null,
          multiplexerAction: multiplexerAction ?? null,
          onData,
          onExit,
        })
      : await invoke<number>("pty_open", {
          cols,
          rows,
          cwd: cwd ?? null,
          workspace: workspaceEnvForNativePty(activeWorkspace),
          blocks: blocks ?? false,
          shell: shell ?? null,
          paneId: paneId ?? null,
          onData,
          onExit,
        });

  let closed = false;
  let activityRetired = false;
  let closing: Promise<void> | undefined;
  const activityReads = new Map<"process" | "job", Promise<boolean>>();
  const headers: Record<string, string> =
    remoteSessionId === undefined
      ? { "x-pty-id": String(id) }
      : {
          "x-pty-id": String(id),
          "x-remote-session-id": String(remoteSessionId),
        };

  return {
    id,
    inspectActivity: (kind) => {
      if (activityRetired || released) return Promise.resolve(true);
      const existing = activityReads.get(kind);
      if (existing) return existing;
      if (pendingActivityProbes >= 256) return Promise.resolve(true);
      pendingActivityProbes++;
      const pending = (async () => {
        try {
          if (remoteSessionId !== undefined) {
            const result = await requestRemoteResult<{ foregroundJob?: unknown }>(
              remoteSessionId, "pty.getActivity", { ptyId: id },
            );
            return activityRetired || released || typeof result?.foregroundJob !== "boolean"
              ? true : result.foregroundJob;
          }
          const result = await invoke<boolean>(
            kind === "process" ? "pty_has_foreground_process" : "pty_has_foreground_job", { id },
          );
          return activityRetired || released || typeof result !== "boolean" ? true : result;
        } catch {
          return true;
        }
      })().finally(() => {
        pendingActivityProbes--;
        if (activityReads.get(kind) === pending) activityReads.delete(kind);
      });
      activityReads.set(kind, pending);
      return pending;
    },
    // Raw bytes + id header: no JSON round-trip on the per-keystroke path.
    write: (data) =>
      invoke(
        remoteSessionId === undefined ? "pty_write" : "remote_pty_write",
        textEncoder.encode(data),
        { headers },
      ),
    resize: (c, r) =>
      remoteSessionId === undefined
        ? invoke("pty_resize", { id, cols: c, rows: r })
        : invoke("remote_pty_resize", {
            sessionId: remoteSessionId,
            ptyId: id,
            cols: c,
            rows: r,
          }),
    close: () => {
      activityRetired = true;
      if (closed) return Promise.resolve();
      if (closing) return closing;
      closing = Promise.resolve().then(async () => {
        try {
          if (remoteSessionId === undefined) {
            await invoke("pty_close", { id });
          } else {
            await invoke("remote_pty_close", {
              sessionId: remoteSessionId,
              ptyId: id,
            });
          }
          closed = true;
        } finally {
          releaseHandlers();
          closing = undefined;
        }
      });
      return closing;
    },
  };
}

export function disposePtyTarget(paneId: number): void {
  void ownedPtyTargets.close(paneId).catch(() => undefined);
  forgetGuestTerminal(paneId);
}

export function capturePtyReconnect(paneId: number) {
  return ownedPtyTargets.captureReconnect(paneId);
}

export function cancelPtyConnection(paneId: number): void {
  const receipt = ownedPtyTargets.get(paneId);
  if (receipt) void receipt.close().catch(() => undefined);
}

export function isGuestPtyTarget(paneId: number): boolean {
  return isCollabGuestLeaf(paneId);
}

export async function getRemotePtyCwd(
  sessionId: number,
  ptyId: number,
): Promise<string> {
  return invoke<string>("remote_pty_get_cwd", { sessionId, ptyId });
}
