export type CloudflaredInstallSuggestion = {
  method: string;
  command: string;
  documentationUrl: string;
};

export type CloudflaredStatus = {
  installed: boolean;
  executable: string | null;
  version: string | null;
  error: string | null;
  suggestion: CloudflaredInstallSuggestion | null;
};

export type HostedTerminalInvite = {
  sessionId: string;
  inviteCode: string;
  loopbackUrl: string;
  expiresAtMs: number;
};

export type PublishedCollabTunnel = {
  publicUrl: string;
  connectionUrl: string;
};

export type CollabParticipantRole = "host" | "controller" | "observer";

export type CollabParticipant = {
  id: string;
  name: string;
  role: CollabParticipantRole;
  controlRequested: boolean;
  typing?: boolean;
};

export type CollabCapabilities = {
  fileCitations: boolean;
};

export type CollabFileSearchResult = {
  files: string[];
  truncated: boolean;
};

export type CollabFileContent = {
  path: string;
  content: string;
  truncated: boolean;
};

export type GuestTerminalWelcome = {
  connectionId: number;
  participant: CollabParticipant;
  cols: number;
  rows: number;
  capabilities: CollabCapabilities;
};

export type CollabServerControl =
  | {
      type: "joined";
      participant: CollabParticipant;
      cols: number;
      rows: number;
      capabilities: CollabCapabilities;
    }
  | { type: "participant_joined"; participant: CollabParticipant }
  | { type: "participant_left"; participantId: string }
  | { type: "control_requested"; participantId: string }
  | {
      type: "role_changed";
      participantId: string;
      role: CollabParticipantRole;
    }
  | {
      type: "file_search_result";
      requestId: string;
      files: Array<{ path: string }>;
      truncated: boolean;
    }
  | {
      type: "file_content";
      requestId: string;
      path: string;
      content: string;
      truncated: boolean;
    }
  | {
      type: "file_error";
      requestId: string;
      code: string;
      message: string;
    }
  | { type: "closed"; reason: string }
  | { type: "error"; code: string; message: string };

export type GuestTerminalCredentials = {
  connectionUrl: string;
  sessionId: string;
  inviteCode: string;
  participantName: string;
};
