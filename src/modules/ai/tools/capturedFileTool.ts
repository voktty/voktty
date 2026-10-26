import { tool } from "ai";
import type { z } from "zod";
import type { ToolContext } from "@/modules/ai/tools/context";
import {
  fileToolCallsFor,
  type FileToolName,
  type FileToolTarget,
} from "@/modules/ai/lib/fileToolCalls";
import { native } from "@/modules/ai/lib/native";
import { usePlanStore } from "@/modules/ai/store/planStore";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  approvedFileToolId,
  isFileToolRunCurrent,
  registerFileToolReceipt,
  registerFileToolRegistry,
  trackFileToolExecution,
} from "@/modules/ai/lib/fileToolApprovals";

export function fileReadCacheKey(
  path: string,
  workspace: WorkspaceEnv,
): string {
  const filesystem =
    workspace.kind === "ssh"
      ? [
          workspace.kind,
          workspace.root,
          workspace.sessionId,
          Object.entries(workspace.connection)
            .filter(([, value]) => value !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        ]
      : workspace.kind === "wsl"
        ? [workspace.kind, workspace.distro]
        : [workspace.kind];
  return JSON.stringify([filesystem, path]);
}

function sameFilesystem(source: WorkspaceEnv, boundary: WorkspaceEnv): boolean {
  if (source.kind !== boundary.kind) return false;
  if (source.kind === "local") return true;
  if (source.kind === "wsl" && boundary.kind === "wsl")
    return source.distro === boundary.distro;
  if (source.kind === "ssh" && boundary.kind === "ssh") {
    const a = source.connection;
    const b = boundary.connection;
    return (
      a.id === b.id &&
      a.host === b.host &&
      a.user === b.user &&
      (a.port ?? 22) === (b.port ?? 22) &&
      a.identityFile === b.identityFile &&
      a.extraArgs === b.extraArgs
    );
  }
  return false;
}

function captureTarget(ctx: ToolContext): FileToolTarget {
  const source = ctx.getFileContext?.();
  const boundary = ctx.getFileRootContext?.();
  if (!source || !boundary)
    throw new Error(
      "The original file source or workspace boundary is unavailable.",
    );
  if (!sameFilesystem(source.workspace, boundary.workspace))
    throw new Error(
      "The file source and workspace boundary belong to different filesystems.",
    );
  return {
    directory: source.directory,
    root: boundary.root,
    workspace: source.workspace,
    sessionId: ctx.getSessionId(),
    modelId: ctx.getModelId?.() ?? "unknown",
    planMode: usePlanStore.getState().active,
  };
}

export type FileExecution = FileToolTarget & {
  assertCurrent: () => void;
  cacheKey: (path: string) => string;
  io: {
    canonicalize: (path: string) => ReturnType<typeof native.canonicalize>;
    readFile: (path: string) => ReturnType<typeof native.readFile>;
    readDir: (path: string) => ReturnType<typeof native.readDir>;
    writeFile: (
      path: string,
      content: string,
    ) => ReturnType<typeof native.writeFile>;
    createDir: (path: string) => ReturnType<typeof native.createDir>;
  };
};

export function capturedFileTool<Input>(
  ctx: ToolContext,
  name: FileToolName,
  definition: {
    description: string;
    inputSchema: z.ZodType<Input>;
    needsApproval?: boolean;
    execute: (
      input: Input,
      execution: FileExecution,
    ) => Promise<Record<string, unknown>>;
  },
) {
  const calls = fileToolCallsFor(ctx);
  const built = tool<Input, Record<string, unknown>, Record<string, unknown>>({
    description: definition.description,
    inputSchema: definition.inputSchema,
    needsApproval: definition.needsApproval,
    onInputAvailable: ({ input, toolCallId, abortSignal }) => {
      if (!isFileToolRunCurrent(built))
        throw new Error("The original file tool run has retired.");
      let retire = () => {};
      let unregister = () => {};
      const receipt = calls.capture(
        toolCallId,
        name,
        definition.inputSchema.parse(input),
        captureTarget(ctx),
        () => {
          abortSignal?.removeEventListener("abort", retire);
          unregister();
        },
      );
      unregister = registerFileToolReceipt(built, toolCallId, receipt);
      retire = receipt.retire;
      abortSignal?.addEventListener("abort", retire, { once: true });
      if (abortSignal?.aborted || !isFileToolRunCurrent(built)) retire();
    },
    execute: async (input, options) => {
      const execution = calls.claim(
        options.toolCallId,
        name,
        definition.inputSchema.parse(input),
        definition.needsApproval
          ? approvedFileToolId(options.messages, options.toolCallId)
          : undefined,
      );
      const untrack = trackFileToolExecution(built, execution);
      const { target } = execution;
      const retire = execution.retire;
      const signal = options.abortSignal;
      signal?.addEventListener("abort", retire, { once: true });
      const assertCurrent = () => {
        if (
          signal?.aborted ||
          !execution.isCurrent() ||
          !isFileToolRunCurrent(built)
        )
          throw new Error("The original file tool call has retired.");
      };
      const guarded = async <Result>(action: () => Promise<Result>) => {
        assertCurrent();
        const result = await action();
        assertCurrent();
        return result;
      };
      try {
        assertCurrent();
        return await definition.execute(definition.inputSchema.parse(input), {
          ...target,
          assertCurrent,
          cacheKey: (path) => fileReadCacheKey(path, target.workspace),
          io: {
            canonicalize: (path) =>
              guarded(() => native.canonicalize(path, target.workspace)),
            readFile: (path) =>
              guarded(() => native.readFile(path, target.workspace)),
            readDir: (path) =>
              guarded(() => native.readDir(path, target.workspace)),
            writeFile: (path, content) =>
              guarded(() => native.writeFile(path, content, target.workspace)),
            createDir: (path) =>
              guarded(() => native.createDir(path, target.workspace)),
          },
        });
      } finally {
        signal?.removeEventListener("abort", retire);
        execution.release();
        untrack();
      }
    },
  });
  registerFileToolRegistry(built, calls);
  return built;
}
