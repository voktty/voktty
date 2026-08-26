import {
  forgetGuestTerminal,
  isCollabGuestLeaf,
  openCollabGuestPty,
} from "@/modules/collab/lib/guestRuntime";
import { consumeSnapshotBarrier } from "@/modules/terminal/lib/snapshotBarrier";
import {
  currentWorkspaceEnv,
  type WorkspaceEnv,
  workspaceEnvForNativePty,
} from "@/modules/workspace";
import { Channel, invoke } from "@tauri-apps/api/core";

const textEncoder = new TextEncoder();

export type PtyHandlers = {
  onData: (bytes: Uint8Array) => void;
  onResize?: (cols: number, rows: number) => void;
  onExit?: (code: number) => void;
};

export type PtySession = {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
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
  if (paneId !== undefined && isCollabGuestLeaf(paneId)) {
    return openCollabGuestPty(paneId, handlers);
  }
  const activeWorkspace = workspace ?? currentWorkspaceEnv();
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
      handlers.onExit?.(code);
      releaseHandlers();
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
    handlers.onExit?.(code);
    releaseHandlers();
  };

  const id =
    remoteSessionId !== undefined
      ? await invoke<number>("remote_pty_open", {
          sessionId: remoteSessionId,
          cols,
          rows,
          cwd: cwd ?? remoteWorkspace?.root,
          blocks: blocks ?? false,
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
  const headers: Record<string, string> =
    remoteSessionId === undefined
      ? { "x-pty-id": String(id) }
      : {
          "x-pty-id": String(id),
          "x-remote-session-id": String(remoteSessionId),
        };

  return {
    id,
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
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        if (remoteSessionId === undefined) {
          await invoke("pty_close", { id });
        } else {
          await invoke("remote_pty_close", {
            sessionId: remoteSessionId,
            ptyId: id,
          });
        }
      } finally {
        releaseHandlers();
      }
    },
  };
}

export function disposePtyTarget(paneId: number): void {
  forgetGuestTerminal(paneId);
}

export function isGuestPtyTarget(paneId: number): boolean {
  return isCollabGuestLeaf(paneId);
}
