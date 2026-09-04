export type HarnessAgentId =
  | "antigravity"
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "grok"
  | "pi";

export type RuntimeMode = "plan" | "act" | "review";

export type ToolPreview = {
  kind: "command" | "read" | "write" | "search" | "patch" | "other";
  target?: string;
  command?: string;
  diff?: string;
  content?: string;
};

export type HarnessEvent =
  | { type: "session.started" }
  | { type: "session.ended"; code?: number | null }
  | { type: "session.error"; message: string }
  | { type: "session.providerBound"; providerSessionId: string }
  | { type: "status"; text: string }
  | { type: "message.delta"; text: string }
  | { type: "message.completed" }
  | { type: "reasoning.delta"; text: string }
  | { type: "reasoning.completed" }
  | {
      type: "tool.started";
      callId: string;
      title: string;
      kind?: string;
      status?: string;
      preview?: ToolPreview;
    }
  | {
      type: "tool.updated";
      callId: string;
      title?: string;
      kind?: string;
      status?: "running" | "completed" | "failed";
      detail?: string;
      preview?: ToolPreview;
    }
  | {
      type: "approval.requested";
      requestId: number;
      title: string;
      kind?: string;
      callId?: string;
      preview?: ToolPreview;
    }
  | {
      type: "approval.resolved";
      requestId: number;
      decision: "allow" | "deny" | "cancelled";
    }
  | { type: "plan"; text: string }
  | { type: "context"; used?: number; window?: number };

export type ReasoningEffort = "off" | "low" | "medium" | "high" | "max";

export type ModelCatalogItem = {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  reasoning: boolean;
};

export const AGENT_MODELS: Record<HarnessAgentId, ModelCatalogItem[]> = {
  antigravity: [
    { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)", provider: "Antigravity", contextWindow: 1_048_576, reasoning: true },
    { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)", provider: "Antigravity", contextWindow: 1_048_576, reasoning: true },
    { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)", provider: "Antigravity", contextWindow: 1_048_576, reasoning: true },
    { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", provider: "Antigravity", contextWindow: 1_048_576, reasoning: true },
    { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", provider: "Antigravity", contextWindow: 1_048_576, reasoning: true },
    { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", provider: "Antigravity", contextWindow: 1_048_576, reasoning: true },
    { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)", provider: "Antigravity", contextWindow: 1_048_576, reasoning: true },
    { id: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)", provider: "Antigravity", contextWindow: 1_048_576, reasoning: true },
    { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)", provider: "Antigravity", contextWindow: 1_048_576, reasoning: true },
    { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)", provider: "Antigravity", contextWindow: 2_000_000, reasoning: true },
    { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", provider: "Antigravity", contextWindow: 2_000_000, reasoning: true },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", provider: "Antigravity", contextWindow: 200_000, reasoning: true },
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)", provider: "Antigravity", contextWindow: 200_000, reasoning: true },
    { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", provider: "Antigravity", contextWindow: 128_000, reasoning: true },
  ],
  claude: [
    { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet (Thinking)", provider: "Anthropic", contextWindow: 200_000, reasoning: true },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: "Anthropic", contextWindow: 200_000, reasoning: false },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "Anthropic", contextWindow: 200_000, reasoning: false },
  ],
  codex: [
    { id: "o3-mini", name: "OpenAI o3-mini (Reasoning)", provider: "OpenAI", contextWindow: 200_000, reasoning: true },
    { id: "o1", name: "OpenAI o1 (Deep Reasoning)", provider: "OpenAI", contextWindow: 200_000, reasoning: true },
    { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", contextWindow: 128_000, reasoning: false },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI", contextWindow: 128_000, reasoning: false },
    { id: "gpt-4.5-preview", name: "GPT-4.5 Preview", provider: "OpenAI", contextWindow: 128_000, reasoning: false },
  ],
  cursor: [
    { id: "claude-3.5-sonnet", name: "Cursor Claude 3.5 Sonnet", provider: "Cursor", contextWindow: 200_000, reasoning: false },
    { id: "gpt-4o", name: "Cursor GPT-4o", provider: "Cursor", contextWindow: 128_000, reasoning: false },
    { id: "cursor-small", name: "Cursor Small Fast", provider: "Cursor", contextWindow: 64_000, reasoning: false },
  ],
  opencode: [
    { id: "deepseek-r1", name: "DeepSeek R1 (Open Reasoning)", provider: "DeepSeek", contextWindow: 64_000, reasoning: true },
    { id: "deepseek-v3", name: "DeepSeek V3", provider: "DeepSeek", contextWindow: 64_000, reasoning: false },
    { id: "qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B", provider: "Qwen", contextWindow: 32_000, reasoning: false },
  ],
  grok: [
    { id: "grok-beta", name: "Grok Beta", provider: "xAI", contextWindow: 128_000, reasoning: false },
  ],
  pi: [
    { id: "pi-default", name: "Inflection Pi", provider: "Inflection", contextWindow: 32_000, reasoning: false },
  ],
};

export const DEFAULT_AGENT_MODELS: Record<HarnessAgentId, string> = {
  antigravity: "gemini-3.7-flash-high",
  claude: "claude-3-7-sonnet-20250219",
  codex: "o3-mini",
  cursor: "claude-3.5-sonnet",
  opencode: "deepseek-r1",
  grok: "grok-beta",
  pi: "pi-default",
};

export const AVAILABLE_MODELS = Object.values(AGENT_MODELS).flat();

export type SendTurnParams = {
  sessionId: string;
  cwd: string;
  model: string;
  runtimeMode: RuntimeMode;
  reasoningEffort?: ReasoningEffort;
  text: string;
  attachments?: string[];
  onEvent: (event: HarnessEvent) => void;
};

export type UserPromptBlock = {
  id: string;
  type: "user";
  text: string;
  attachments?: string[];
  timestamp: number;
};

export type AssistantBlock = {
  id: string;
  type: "assistant";
  text: string;
  reasoning?: string;
  isStreaming?: boolean;
  timestamp: number;
};

export type ToolBlock = {
  id: string;
  type: "tool";
  callId: string;
  title: string;
  kind: "command" | "read" | "write" | "search" | "patch" | "other";
  status: "running" | "completed" | "failed";
  detail?: string;
  preview?: ToolPreview;
  timestamp: number;
};

export type ApprovalBlock = {
  id: string;
  type: "approval";
  requestId: number;
  title: string;
  callId?: string;
  preview?: ToolPreview;
  decision?: "allow" | "deny" | "pending";
  timestamp: number;
};

export type ThoughtBlock = {
  id: string;
  type: "thought";
  text: string;
  timestamp: number;
};

export type HarnessBlock =
  | UserPromptBlock
  | AssistantBlock
  | ThoughtBlock
  | ToolBlock
  | ApprovalBlock;

export type CheckpointFile = {
  relative: string;
  status: "added" | "modified" | "deleted" | "untracked";
  additions: number;
  deletions: number;
};

export type CheckpointStatus = {
  sessionId: string;
  cwd: string;
  files: CheckpointFile[];
  totalAdditions: number;
  totalDeletions: number;
};

export type ModelContextWindow = {
  model: string;
  maxTokens: number;
  warningThresholdRatio: number;
};

export type HarnessProbeResult = {
  harness: string;
  binary: string;
  installed: boolean;
  version?: string;
  path?: string;
};

export type HarnessSession = {
  id: string;
  cwd: string;
  harness: HarnessAgentId;
  model: string;
  modelSettings: Record<string, any>;
  runtimeMode: RuntimeMode;
  title: string;
  providerSessionId?: string;
  blocks: HarnessBlock[];
  contextUsed?: number;
  contextWindow?: number;
  branch?: string;
  createdAt: number;
  updatedAt: number;
};

export type HarnessSessionSummary = {
  id: string;
  cwd: string;
  harness: string;
  model: string;
  title: string;
  branch?: string;
  blockCount: number;
  contextUsed?: number;
  contextWindow?: number;
  createdAt: number;
  updatedAt: number;
};
