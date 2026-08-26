import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import {
  buildDevelopmentContext,
  type DevelopmentGitContext,
} from "../lib/developmentContext";
import {
  discoverDevelopmentChecks,
  type DevelopmentCheckKind,
} from "../lib/developmentChecks";
import { native } from "../lib/native";
import {
  checkCanonicalWorkspacePath,
  checkReadableCanonical,
} from "../lib/security";
import type { ToolContext } from "./context";
import { usePlanStore } from "../store/planStore";

const CHECK_OUTPUT_CAP = 64 * 1024;

async function verifiedRoot(
  ctx: ToolContext,
): Promise<{ ok: true; root: string } | { ok: false; error: string }> {
  const root = ctx.getWorkspaceRoot();
  if (!root) return { ok: false, error: "no active workspace root" };
  const readable = await checkReadableCanonical(root, native.canonicalize);
  if (!readable.ok) return { ok: false, error: readable.reason };
  const boundary = await checkCanonicalWorkspacePath(
    readable.canonical,
    root,
    native.canonicalize,
  );
  return boundary.ok
    ? { ok: true, root: readable.canonical }
    : { ok: false, error: boundary.reason };
}

async function gitContext(root: string): Promise<DevelopmentGitContext | null> {
  try {
    const repo = await native.gitResolveRepo(root);
    if (!repo) return null;
    const status = await native.gitStatus(repo.repoRoot);
    return {
      branch: status.branch,
      changedFiles: status.changedFiles.map((file) => ({
        path: file.path,
        status:
          `${file.indexStatus}${file.worktreeStatus}`.trim() ||
          file.statusLabel,
      })),
    };
  } catch {
    return null;
  }
}

async function waitForCheck(
  handle: number,
  timeoutMs: number,
  options: ToolExecutionOptions,
) {
  const started = Date.now();
  let offset = 0;
  let output = "";
  while (true) {
    if (options.abortSignal?.aborted) {
      await native.shellBgKill(handle).catch(() => {});
      return { cancelled: true, timed_out: false, exit_code: null, output };
    }
    if (Date.now() - started >= timeoutMs) {
      await native.shellBgKill(handle).catch(() => {});
      return { cancelled: false, timed_out: true, exit_code: null, output };
    }
    const logs = await native.shellBgLogs(handle, offset);
    offset = logs.next_offset;
    if (logs.bytes) output = `${output}${logs.bytes}`.slice(-CHECK_OUTPUT_CAP);
    if (logs.exited) {
      return {
        cancelled: false,
        timed_out: false,
        exit_code: logs.exit_code,
        output,
        dropped: logs.dropped,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

export function buildDevelopmentTools(ctx: ToolContext) {
  return {
    development_context: tool({
      description:
        "Collect a bounded development snapshot of open editor buffers, symbols, diagnostics, Git status, terminal tail, and available format/type/test checks. Sensitive and out-of-workspace paths are excluded. Call before planning non-trivial code changes.",
      inputSchema: z.object({}),
      execute: async () => {
        const verified = await verifiedRoot(ctx);
        if (!verified.ok) return { error: verified.error };
        const checks = await discoverDevelopmentChecks(verified.root);
        return buildDevelopmentContext({
          workspaceRoot: verified.root,
          activeFile: ctx.getActiveFile?.() ?? null,
          buffers: (await ctx.getEditorBuffers?.()) ?? [],
          diagnostics: ctx.getWorkspaceDiagnostics?.() ?? [],
          git: await gitContext(verified.root),
          terminal: ctx.getTerminalContext(),
          checks: checks.map((check) => check.command),
        });
      },
    }),
    run_development_check: tool({
      description:
        "Run one discovered format, type, or test check in the active workspace. The command must exactly match the bounded development context, requires approval, and is cancellable.",
      inputSchema: z.object({
        kind: z.enum(["format", "types", "tests"]),
        command: z
          .string()
          .describe("Exact command returned by development_context."),
        timeout_secs: z.number().int().min(1).max(300).optional(),
      }),
      needsApproval: true,
      execute: async ({ kind, command, timeout_secs }, options) => {
        const verified = await verifiedRoot(ctx);
        if (!verified.ok) return { error: verified.error };
        const checks = await discoverDevelopmentChecks(verified.root);
        const allowed = checks.some(
          (check) =>
            check.kind === (kind as DevelopmentCheckKind) &&
            check.command === command,
        );
        if (!allowed)
          return { error: "command is not a discovered workspace check" };
        let handle: number | null = null;
        let result: Awaited<ReturnType<typeof waitForCheck>>;
        try {
          handle = await native.shellBgSpawn(command, verified.root);
          result = await waitForCheck(
            handle,
            (timeout_secs ?? 300) * 1000,
            options,
          );
        } catch (error) {
          if (handle !== null) await native.shellBgKill(handle).catch(() => {});
          return { error: String(error), kind, command, cwd: verified.root };
        }
        usePlanStore.getState().recordCommand({
          kind,
          command,
          exitCode: result.exit_code,
          cancelled: result.cancelled,
          timedOut: result.timed_out,
          ranAt: Date.now(),
        });
        return { kind, command, cwd: verified.root, ...result };
      },
    }),
  } as const;
}
