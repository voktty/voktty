export const TEAM_STATE_SCHEMA = "urn:voktty:team-state:1" as const;

export type TeamAgentStatus =
  | "unopened"
  | "working"
  | "idle"
  | "waiting_approval"
  | "quota_paused"
  | "error"
  | "host_unconfigured";

export type TeamAgentVerdict = {
  text: string;
  timestamp: string;
  messageId?: string;
};

export type TeamAgentCopyState = {
  sessionId: string;
  providerSessionId?: string;
  lastOpenedAt: string;
  status: TeamAgentStatus;
  task?: string;
  worktree: string;
  supervised: boolean;
};

export type TeamAgentState = {
  sessionId?: string;
  providerSessionId?: string;
  lastOpenedAt?: string;
  status: TeamAgentStatus;
  task?: string;
  currentTaskStartedAt?: string;
  lastVerdict?: TeamAgentVerdict;
  worktree?: string | null;
  supervised?: boolean;
  copies?: Record<string, TeamAgentCopyState>;
};

export type TeamState = {
  $schema: typeof TEAM_STATE_SCHEMA;
  version: 1;
  updatedAt: string;
  agents: Record<string, TeamAgentState>;
};

export type LiveAgentPermissions = {
  canManageAgents: boolean;
};

export type LiveAgentSession = {
  sessionId: string;
  agentName: string;
  projectPath: string;
  role: string;
  isOrchestrator: boolean;
  permissions: LiveAgentPermissions;
  pid?: number;
  launchedAt: string;
  agentToken: string;
};

export type OpenAgentParams = {
  projectPath: string;
  agentName: string;
  mode?: "new" | "resume";
  task?: string;
  model?: string;
  supervised?: boolean;
  copy?: number;
  spaceId?: string;
};

export type OpenAgentResult = {
  ok: boolean;
  agent: string;
  sessionId: string;
  tabId?: number;
  mode: "new" | "resume";
  supervised: boolean;
  error?: string;
  reason?: string;
};

export type TeamMessageKind =
  | "task"
  | "verdict"
  | "decision"
  | "blocker"
  | "status"
  | "question";

export type TeamBusMessage = {
  id: string;
  projectPath: string;
  from: string;
  to: string;
  kind: TeamMessageKind;
  text: string;
  timestamp: string;
  replyTo?: string;
  hop: number;
  delivered: boolean;
  read: boolean;
};

export type TeamBusState = {
  version: 1;
  updatedAt: string;
  messages: TeamBusMessage[];
};
