export type KitValues = Readonly<{
  project_name: string;
  project_summary: string;
  owner_title: string;
  primary_branch: string;
  verify_commands: string;
  language: string;
  created_at: string;
  kit_version: string;
  default_runtime: string;
  default_model: string;
}>;

export type KitLock = Readonly<{
  schema: 1;
  bases: readonly Readonly<{
    path: string;
    version: string;
    sha256: string;
  }>[];
}>;

export type KitConfig = Readonly<{
  $schema?: "./kit.schema.json";
  kit: "voktty-workspace-kit";
  kitVersion: string;
  schema: 1;
  project: string;
  language: string;
  createdAt: string;
  init: "INIT.md";
  roster?: "team/agents.json";
  values?: KitValues;
  capture: Readonly<{
    onSessionEnd: boolean;
    beforeCompaction: boolean;
    compactionThresholdPercent: number;
    every: Readonly<{ turns: number; minutes: number; commits: number }>;
    staleAfterCommits: number;
  }>;
  limits: Readonly<{
    "CONTEXT.md"?: Readonly<{ maxChars: number }>;
    "PROJECT.md"?: Readonly<{ maxChars: number }>;
    "plans/TRACKING.md"?: Readonly<{ maxChars: number; maxUpNext: number }>;
    "plans/INDEX.md"?: Readonly<{ maxChars: number }>;
    "continuity/CHANGELOG.md"?: Readonly<{ maxChars: number }>;
    "continuity/handoffs/"?: Readonly<{ maxFiles: number; maxAgeDays: number }>;
  }>;
  archive: Readonly<{ dir: "archive"; afterDays: number; ritual: "weekly" }>;
  runtimeDirs: readonly ["state", "mailbox", "locks", "sessions"];
}>;

export type AgentRuntime = Readonly<{
  adapter?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  command?: string;
}>;
export type AgentDefinition = Readonly<{
  name: string;
  role: string;
  start: "always" | "on-demand";
  description?: string;
  runtime?: AgentRuntime;
  host?: string;
  session?: "new-per-task" | "resume";
  workspace?: "shared" | "worktree";
  workdir?: string;
  owns?: readonly string[];
  reads?: readonly string[];
}>;
export type AgentRoster = Readonly<{
  $schema?: string;
  version: 1;
  defaults?: Readonly<{
    runtime?: AgentRuntime;
    host?: string;
    session?: "new-per-task" | "resume";
    workspace?: "shared" | "worktree";
  }>;
  policies?: Readonly<{
    forbiddenModels?: readonly string[];
    heavyTestLock?: Readonly<{ name: string; staleAfterMinutes?: number }>;
    messages?: readonly string[];
  }>;
  agents: readonly AgentDefinition[];
}>;
