import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkShellCommand } from "../lib/security";
import { resolvePath, type ToolContext } from "./context";
import type { FileToolTarget } from "@/modules/ai/lib/fileToolCalls";
import { agentShellSessions } from "@/modules/ai/lib/ownedShellSessions";
import {
  capturedTool,
  fileReadCacheKey,
  type CapturedExecution,
} from "@/modules/ai/tools/capturedFileTool";

function runInSessionShell(
  ctx: ToolContext,
  captured: CapturedExecution,
  command: string,
  timeoutSecs?: number,
) {
  captured.assertCurrent();
  const key = JSON.stringify([
    captured.sessionId,
    fileReadCacheKey(captured.directory, captured.workspace),
  ]);
  return agentShellSessions.run(ctx, key, {
    assertCurrent: captured.assertCurrent,
    open: () => native.shellSessionOpen(captured.directory, captured.workspace),
    close: native.shellSessionClose,
    execute: (shellId) =>
      captured.guarded(() =>
        native.shellSessionRun(
          shellId,
          command,
          captured.directory,
          timeoutSecs,
          captured.workspace,
        ),
      ),
  });
}

function captureShellTarget(ctx: ToolContext): FileToolTarget {
  const source = ctx.getFileContext?.();
  const sessionId = ctx.getSessionId();
  if (!source || !sessionId)
    throw new Error("The original shell destination or chat is unavailable.");
  return {
    directory: source.directory,
    root: source.directory,
    workspace: source.workspace,
    sessionId,
  };
}

export function buildShellTools(ctx: ToolContext) {
  return {
    bash_run: capturedTool(ctx, "bash_run", {
      description:
        "Run a foreground shell command in this session's persistent agent shell. cwd persists across calls (so `cd foo` then `bash_run pwd` works). Use for short-lived commands (lint, test, search, build). For long-running or daemon processes (dev servers, watch tasks), use `bash_background`. NEVER invoke interactive tools (vim, less, top) — they will hang. Asks for user approval.",
      inputSchema: z.object({
        command: z.string(),
        timeout_secs: z.number().int().min(1).max(300).optional(),
      }),
      needsApproval: true,
      captureTarget: captureShellTarget,
      execute: async ({ command, timeout_secs }, captured) => {
        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };
        try {
          const r = await runInSessionShell(
            ctx,
            captured,
            command,
            timeout_secs,
          );
          return {
            command,
            stdout: r.stdout,
            stderr: r.stderr,
            exit_code: r.exit_code,
            timed_out: r.timed_out,
            truncated: r.truncated,
            cwd_after: r.cwd_after,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    bash_background: capturedTool(ctx, "bash_background", {
      description:
        "Spawn a long-running background process (e.g. `pnpm dev`, `cargo watch`, log tailers). Returns a handle; use `bash_logs` to read its output and `bash_kill` to stop it. Output is captured into a 4MB ring buffer. Asks for user approval.",
      inputSchema: z.object({
        command: z.string(),
        cwd: z.string().nullable().optional(),
      }),
      needsApproval: true,
      captureTarget: captureShellTarget,
      execute: async ({ command, cwd }, captured) => {
        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };
        try {
          const effectiveCwd = cwd
            ? resolvePath(cwd, captured.directory)
            : captured.directory;
          const handle = await captured.guarded(() =>
            native.shellBgSpawn(command, effectiveCwd, captured.workspace),
          );
          return { handle, command, cwd: effectiveCwd, ok: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    bash_logs: tool({
      description:
        "Read accumulated logs from a `bash_background` process. Pass `since_offset` from the previous response's `next_offset` to tail incrementally. `dropped` reports bytes evicted by the ring buffer.",
      inputSchema: z.object({
        handle: z.number().int(),
        since_offset: z.number().int().optional(),
      }),
      execute: async ({ handle, since_offset }) => {
        try {
          const r = await native.shellBgLogs(handle, since_offset);
          return r;
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    bash_list: tool({
      description:
        "List all background processes spawned by `bash_background` in this app — running and exited. **Always call this BEFORE spawning a new long-running process** (especially dev servers like `pnpm dev`, `next dev`, `vite`) to avoid duplicates. If a matching process is already running, reuse it (call `open_preview` again instead of respawning). Auto-executes.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const list = await native.shellBgList();
          return { processes: list };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    bash_kill: tool({
      description:
        "Terminate a `bash_background` process by handle. Idempotent — kills nothing if the handle is unknown or already exited.",
      inputSchema: z.object({ handle: z.number().int() }),
      execute: async ({ handle }) => {
        try {
          await native.shellBgKill(handle);
          return { handle, ok: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
