import {
  connectToHostedTerminal,
  type GuestTerminalHandlers,
  type GuestTerminalSession,
} from "@/modules/collab/lib/guest";
import type {
  CollabCapabilities,
  CollabFileContent,
  CollabFileSearchResult,
  CollabParticipantRole,
  CollabServerControl,
  GuestTerminalCredentials,
} from "@/modules/collab/types";
import { create } from "zustand";

export type CollabGuestStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

export type CollabGuestView = {
  status: CollabGuestStatus;
  role: CollabParticipantRole;
  participantId: string | null;
  participantName: string;
  error: string | null;
  controlRequested: boolean;
  capabilities: CollabCapabilities;
};

type CollabGuestStore = {
  sessions: Record<number, CollabGuestView>;
};

export const useCollabGuestStore = create<CollabGuestStore>(() => ({
  sessions: {},
}));

const credentialsByLeaf = new Map<number, GuestTerminalCredentials>();
const liveSessions = new Map<number, GuestTerminalSession>();
const FILE_REQUEST_TIMEOUT_MS = 10_000;
let nextFileRequestId = 1;

type PendingFileRequest =
  | {
      kind: "search";
      resolve: (value: CollabFileSearchResult) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  | {
      kind: "read";
      resolve: (value: CollabFileContent) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    };

const pendingFileRequests = new Map<number, Map<string, PendingFileRequest>>();

function updateGuestView(
  leafId: number,
  patch: Partial<CollabGuestView>,
): void {
  useCollabGuestStore.setState((state) => {
    const current = state.sessions[leafId];
    if (!current) return state;
    return {
      sessions: {
        ...state.sessions,
        [leafId]: { ...current, ...patch },
      },
    };
  });
}

export function registerGuestTerminal(
  leafId: number,
  credentials: GuestTerminalCredentials,
): void {
  credentialsByLeaf.set(leafId, credentials);
  useCollabGuestStore.setState((state) => ({
    sessions: {
      ...state.sessions,
      [leafId]: {
        status: "connecting",
        role: "observer",
        participantId: null,
        participantName: credentials.participantName,
        error: null,
        controlRequested: false,
        capabilities: { fileCitations: false },
      },
    },
  }));
}

export function isCollabGuestLeaf(leafId: number): boolean {
  return credentialsByLeaf.has(leafId);
}

function applyControlMessage(
  leafId: number,
  participantId: string,
  message: CollabServerControl,
): void {
  if (message.type === "joined") {
    updateGuestView(leafId, {
      status: "connected",
      role: message.participant.role,
      participantId: message.participant.id,
      participantName: message.participant.name,
      error: null,
      controlRequested: false,
      capabilities: message.capabilities,
    });
  } else if (
    message.type === "role_changed" &&
    message.participantId === participantId
  ) {
    updateGuestView(leafId, {
      role: message.role,
      controlRequested: false,
    });
  } else if (message.type === "closed") {
    updateGuestView(leafId, {
      status: "disconnected",
      error: message.reason,
    });
  } else if (message.type === "error") {
    updateGuestView(leafId, { error: message.message });
  }
}

function applyFileControlMessage(
  leafId: number,
  message: CollabServerControl,
): boolean {
  if (
    message.type !== "file_search_result" &&
    message.type !== "file_content" &&
    message.type !== "file_error"
  ) {
    return false;
  }
  const requests = pendingFileRequests.get(leafId);
  const pending = requests?.get(message.requestId);
  if (!pending) return true;
  clearTimeout(pending.timeout);
  requests?.delete(message.requestId);
  if (requests?.size === 0) pendingFileRequests.delete(leafId);

  if (message.type === "file_error") {
    pending.reject(new Error(`${message.code}: ${message.message}`));
  } else if (
    message.type === "file_search_result" &&
    pending.kind === "search"
  ) {
    pending.resolve({
      files: message.files.map((file) => file.path),
      truncated: message.truncated,
    });
  } else if (message.type === "file_content" && pending.kind === "read") {
    pending.resolve({
      path: message.path,
      content: message.content,
      truncated: message.truncated,
    });
  } else {
    pending.reject(new Error("collab_file_response_mismatch"));
  }
  return true;
}

function rejectPendingFileRequests(leafId: number, reason: string): void {
  const requests = pendingFileRequests.get(leafId);
  if (!requests) return;
  pendingFileRequests.delete(leafId);
  for (const pending of requests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }
}

function makeFileRequestId(leafId: number): string {
  const sequence = nextFileRequestId++;
  return `${leafId}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export async function openCollabGuestPty(
  leafId: number,
  handlers: GuestTerminalHandlers,
): Promise<{
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
}> {
  const credentials = credentialsByLeaf.get(leafId);
  if (!credentials) throw new Error("collab_guest_not_registered");

  updateGuestView(leafId, {
    status: "connecting",
    error: null,
    controlRequested: false,
  });
  let participantId = "";
  let session: GuestTerminalSession;
  try {
    session = await connectToHostedTerminal(credentials, {
      onData: handlers.onData,
      onResize: handlers.onResize,
      onControl: (message) => {
        if (message.type === "joined") {
          participantId = message.participant.id;
          handlers.onResize?.(message.cols, message.rows);
        }
        if (!applyFileControlMessage(leafId, message)) {
          applyControlMessage(leafId, participantId, message);
        }
        handlers.onControl?.(message);
      },
      onExit: (code) => {
        rejectPendingFileRequests(leafId, "collab_guest_disconnected");
        liveSessions.delete(leafId);
        if (
          useCollabGuestStore.getState().sessions[leafId]?.status !== "failed"
        ) {
          updateGuestView(leafId, { status: "disconnected" });
        }
        handlers.onExit?.(code);
      },
      onStatus: (status) => {
        if (status !== "connected") {
          rejectPendingFileRequests(leafId, "collab_guest_reconnecting");
        }
        updateGuestView(leafId, {
          status,
          error: status === "failed" ? "collab_guest_reconnect_failed" : null,
          controlRequested: false,
        });
      },
    });
  } catch (error) {
    updateGuestView(leafId, { status: "failed", error: String(error) });
    throw error;
  }

  participantId = session.welcome.participant.id;
  liveSessions.set(leafId, session);
  updateGuestView(leafId, {
    status: "connected",
    role: session.welcome.participant.role,
    participantId,
    participantName: session.welcome.participant.name,
    error: null,
    capabilities: session.welcome.capabilities,
  });

  return {
    id: -session.welcome.connectionId,
    write: async (data) => {
      const view = useCollabGuestStore.getState().sessions[leafId];
      if (
        view?.status !== "connected" ||
        (view.role !== "controller" && view.role !== "host")
      ) {
        return;
      }
      await session.write(data);
    },
    resize: session.resize,
    close: async () => {
      liveSessions.delete(leafId);
      rejectPendingFileRequests(leafId, "collab_guest_closed");
      await session.close();
      updateGuestView(leafId, { status: "disconnected" });
    },
  };
}

export async function requestGuestControl(leafId: number): Promise<void> {
  const session = liveSessions.get(leafId);
  if (!session) throw new Error("collab_guest_not_connected");
  updateGuestView(leafId, { controlRequested: true, error: null });
  try {
    await session.requestControl();
  } catch (error) {
    updateGuestView(leafId, {
      controlRequested: false,
      error: String(error),
    });
    throw error;
  }
}

export async function releaseGuestControl(leafId: number): Promise<void> {
  const session = liveSessions.get(leafId);
  if (!session) throw new Error("collab_guest_not_connected");
  await session.releaseControl();
}

export function guestFileCitationsEnabled(leafId: number): boolean {
  const view = useCollabGuestStore.getState().sessions[leafId];
  return view?.status === "connected" && view.capabilities.fileCitations;
}

export function searchGuestFiles(
  leafId: number,
  query: string,
  limit = 30,
): Promise<CollabFileSearchResult> {
  const session = liveSessions.get(leafId);
  if (!session || !guestFileCitationsEnabled(leafId)) {
    return Promise.reject(new Error("collab_file_citations_unavailable"));
  }
  const requestId = makeFileRequestId(leafId);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingFileRequests.get(leafId)?.delete(requestId);
      reject(new Error("collab_file_request_timeout"));
    }, FILE_REQUEST_TIMEOUT_MS);
    const requests = pendingFileRequests.get(leafId) ?? new Map();
    requests.set(requestId, { kind: "search", resolve, reject, timeout });
    pendingFileRequests.set(leafId, requests);
    void session.fileSearch(requestId, query, limit).catch((error) => {
      clearTimeout(timeout);
      requests.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

export function readGuestFile(
  leafId: number,
  path: string,
): Promise<CollabFileContent> {
  const session = liveSessions.get(leafId);
  if (!session || !guestFileCitationsEnabled(leafId)) {
    return Promise.reject(new Error("collab_file_citations_unavailable"));
  }
  const requestId = makeFileRequestId(leafId);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingFileRequests.get(leafId)?.delete(requestId);
      reject(new Error("collab_file_request_timeout"));
    }, FILE_REQUEST_TIMEOUT_MS);
    const requests = pendingFileRequests.get(leafId) ?? new Map();
    requests.set(requestId, { kind: "read", resolve, reject, timeout });
    pendingFileRequests.set(leafId, requests);
    void session.fileRead(requestId, path).catch((error) => {
      clearTimeout(timeout);
      requests.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

export function forgetGuestTerminal(leafId: number): void {
  rejectPendingFileRequests(leafId, "collab_guest_forgotten");
  credentialsByLeaf.delete(leafId);
  liveSessions.delete(leafId);
  useCollabGuestStore.setState((state) => {
    if (!(leafId in state.sessions)) return state;
    const sessions = { ...state.sessions };
    delete sessions[leafId];
    return { sessions };
  });
}
