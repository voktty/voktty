import { pathKey } from "@/modules/harness/lib/paths";
import type { HarnessId } from "@/modules/harness/lib/session";
import type { OrchestrationChoice } from "./orchestrationPlan";

export type TaskStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "blocked"
  | "interrupted"
  | "cancelled";

export type WorkspacePolicy =
  | "shared"
  | "isolated-child"
  | "isolated-top-level";

export type OrchestrationWorkspace = {
  /** Stable comparison identity; not a display path. */
  id: string;
  /** Project identity used by recents, history and project-level settings. */
  projectCwd: string;
  /** Concrete checkout in which this run may read and write. */
  checkoutCwd: string;
  kind: "main" | "worktree";
  branch?: string;
};

export type DispatchState =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "interrupted"
  | "cancelled"
  | "start_unknown"
  | "stop_unknown";

export type DispatchStage =
  | "accepted"
  | "session_prepared"
  | "turn_submitted"
  | "settled"
  | "integration_started"
  | "integrated"
  | "cleaned";

export type OrchestrationDispatch = {
  id: string;
  taskId: string;
  sessionId: string;
  workspace: OrchestrationWorkspace;
  state: DispatchState;
  stage: DispatchStage;
  startedAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
  cleanupError?: string;
};

export type OrchestrationTask = {
  id: string;
  assignmentId?: string;
  sessionId: string;
  title: string;
  harness: HarnessId;
  model: string;
  modelSettings?: Record<string, string>;
  prompt: string;
  files: string[];
  /** Logical scopes in the lead checkout, used for scheduling overlap. */
  scopes: string[];
  /** The same scopes resolved inside this worker's isolated checkout. */
  writeScopes?: string[];
  scratchDir?: string;
  dependsOn: string[];
  status: TaskStatus;
  accepted: boolean;
  result: string;
  error?: string;
  /** A retained worker can continue safely with this recovery turn. */
  recoveryPrompt?: string;
  delivered: boolean;
  /** Workspace selection is independent from task/dependency identity. */
  workspacePolicy?: WorkspacePolicy;
  /** A retry reuses its worker checkout so partial work is never orphaned. */
  workspace?: OrchestrationWorkspace;
  /** Only this dispatch may settle the task. A retry always gets a new id. */
  activeDispatchId?: string;
  lastDispatchId?: string;
  acceptedDispatchId?: string;
};

export type OrchestrationRun = {
  version: 1 | 2;
  leadId: string;
  cwd: string;
  workspace?: OrchestrationWorkspace;
  canonicalRoot?: string;
  status: "active" | "paused" | "stopped" | "finished";
  allowedHarnesses: HarnessId[];
  allowedModels?: OrchestrationChoice[];
  proposalId?: string;
  maxWorkers: number;
  cli: string;
  tasks: OrchestrationTask[];
  dispatches?: OrchestrationDispatch[];
  error?: string;
  continuations: number;
  lastPauseReason?: string;
  requests: Record<string, { signature: string; result: unknown }>;
};

export function workspaceIdentity(
  projectCwd: string,
  checkoutCwd: string,
  branch?: string,
): OrchestrationWorkspace {
  return {
    id: `checkout:${pathKey(checkoutCwd)}`,
    projectCwd,
    checkoutCwd,
    kind: pathKey(projectCwd) === pathKey(checkoutCwd) ? "main" : "worktree",
    ...(branch ? { branch } : {}),
  };
}

export function orchestrationWorkspace(
  run: OrchestrationRun,
): OrchestrationWorkspace {
  return run.workspace ?? workspaceIdentity(run.cwd, run.cwd);
}

export const orchestrationProjectCwd = (run: OrchestrationRun): string =>
  orchestrationWorkspace(run).projectCwd;

export const orchestrationCheckoutCwd = (run: OrchestrationRun): string =>
  orchestrationWorkspace(run).checkoutCwd;

export function normalizeOrchestrationRun(
  run: OrchestrationRun,
): OrchestrationRun {
  const workspace = orchestrationWorkspace(run);
  const legacyPauseError = run.status === "paused" ? run.error : undefined;
  const escaped =
    legacyPauseError &&
    run.tasks.find((task) =>
      legacyPauseError.startsWith(
        `${task.title} reported a write outside its assignment:`,
      ),
    )?.id;
  const tasks = run.tasks.map((task) => {
    const legacyInterrupted =
      !!legacyPauseError &&
      task.status === "failed" &&
      task.error === legacyPauseError;
    return {
      ...task,
      ...(legacyInterrupted
        ? {
            status:
              task.id === escaped
                ? ("blocked" as const)
                : ("interrupted" as const),
            delivered: task.id === escaped ? false : true,
          }
        : {}),
      workspacePolicy:
        task.workspacePolicy ??
        (run.version === 1 ? "shared" : "isolated-child"),
    };
  });
  const statusByDispatch = new Map(
    tasks.flatMap((task) =>
      task.lastDispatchId &&
      (task.status === "blocked" || task.status === "interrupted")
        ? [[task.lastDispatchId, task.status] as const]
        : [],
    ),
  );
  return {
    ...run,
    version: 2,
    cwd: workspace.projectCwd,
    workspace,
    tasks,
    dispatches: (run.dispatches ?? []).map((dispatch) => ({
      ...dispatch,
      state: statusByDispatch.get(dispatch.id) ?? dispatch.state,
    })),
  };
}
