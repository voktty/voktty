import type {
  CollabServerControl,
  GuestTerminalCredentials,
  GuestTerminalWelcome,
} from "@/modules/collab/types";
import { Channel, invoke } from "@tauri-apps/api/core";

const textEncoder = new TextEncoder();

export type GuestTerminalHandlers = {
  onData: (bytes: Uint8Array) => void;
  onResize?: (cols: number, rows: number) => void;
  onControl?: (message: CollabServerControl) => void;
  onExit?: (code: number) => void;
  onStatus?: (status: "connected" | "reconnecting" | "failed") => void;
};

export type GuestTerminalEvent =
  | { type: "output"; data: Uint8Array }
  | { type: "snapshot"; cols: number; rows: number; data: Uint8Array }
  | { type: "resize"; cols: number; rows: number };

export function decodeGuestTerminalEvent(
  buffer: ArrayBuffer,
): GuestTerminalEvent | null {
  const bytes = new Uint8Array(buffer);
  const kind = bytes[0];
  if (kind === 1) return { type: "output", data: bytes.subarray(1) };
  if ((kind !== 2 && kind !== 3) || bytes.length < 5) return null;
  const cols = (bytes[1] << 8) | bytes[2];
  const rows = (bytes[3] << 8) | bytes[4];
  if (cols <= 0 || rows <= 0) return null;
  return kind === 2
    ? { type: "snapshot", cols, rows, data: bytes.subarray(5) }
    : { type: "resize", cols, rows };
}

export type GuestTerminalSession = {
  welcome: GuestTerminalWelcome;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  requestControl: () => Promise<void>;
  releaseControl: () => Promise<void>;
  fileSearch: (
    requestId: string,
    query: string,
    limit: number,
  ) => Promise<void>;
  fileRead: (requestId: string, path: string) => Promise<void>;
  close: () => Promise<void>;
};

export async function connectToHostedTerminal(
  credentials: GuestTerminalCredentials,
  handlers: GuestTerminalHandlers,
): Promise<GuestTerminalSession> {
  const onData = new Channel<ArrayBuffer>();
  const onControl = new Channel<CollabServerControl>();
  const onExit = new Channel<number>();
  const onStatus = new Channel<"connected" | "reconnecting" | "failed">();
  let receivedGridEvent = false;
  let released = false;
  const noop = () => {};
  const releaseHandlers = () => {
    if (released) return;
    released = true;
    onData.onmessage = noop;
    onControl.onmessage = noop;
    onExit.onmessage = noop;
    onStatus.onmessage = noop;
  };
  onData.onmessage = (data) => {
    const event = decodeGuestTerminalEvent(data);
    if (!event) return;
    if (event.type !== "output") {
      receivedGridEvent = true;
      handlers.onResize?.(event.cols, event.rows);
    }
    if (event.type !== "resize") handlers.onData(event.data);
  };
  onControl.onmessage = (message) => handlers.onControl?.(message);
  onExit.onmessage = (code) => {
    handlers.onExit?.(code);
    releaseHandlers();
  };
  onStatus.onmessage = (status) => handlers.onStatus?.(status);

  let welcome: GuestTerminalWelcome;
  try {
    welcome = await invoke<GuestTerminalWelcome>("collab_guest_connect", {
      connectionUrl: credentials.connectionUrl.trim(),
      sessionId: credentials.sessionId.trim(),
      inviteCode: credentials.inviteCode.trim(),
      participantName: credentials.participantName.trim(),
      onData,
      onControl,
      onExit,
      onStatus,
    });
  } catch (error) {
    releaseHandlers();
    throw error;
  }

  if (!receivedGridEvent) handlers.onResize?.(welcome.cols, welcome.rows);

  const connectionId = welcome.connectionId;
  const headers: Record<string, string> = {
    "x-collab-id": String(connectionId),
  };
  let closed = false;
  return {
    welcome,
    write: (data) =>
      invoke("collab_guest_write", textEncoder.encode(data), { headers }),
    resize: async () => {},
    requestControl: () =>
      invoke("collab_guest_request_control", { connectionId }),
    releaseControl: () =>
      invoke("collab_guest_release_control", { connectionId }),
    fileSearch: (requestId, query, limit) =>
      invoke("collab_guest_file_search", {
        connectionId,
        requestId,
        query,
        limit,
      }),
    fileRead: (requestId, path) =>
      invoke("collab_guest_file_read", { connectionId, requestId, path }),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await invoke("collab_guest_close", { connectionId });
      } finally {
        releaseHandlers();
      }
    },
  };
}
