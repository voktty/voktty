import { extensionAiTools } from "@/modules/extensions/lib/vokttyApi";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 128 * 1024;
const EXECUTION_TIMEOUT_MS = 30_000;
const SAFE_TOOL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

function boundedOutput(value: string | Record<string, unknown>) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return serialized.length <= MAX_OUTPUT_BYTES
    ? value
    : { error: "extension tool output exceeded the 128 KiB limit" };
}

export function buildExtensionTools(reservedNames: ReadonlySet<string>) {
  const tools: ToolSet = {};
  for (const [name, definition] of extensionAiTools) {
    if (!SAFE_TOOL_NAME.test(name) || reservedNames.has(name)) continue;
    tools[name] = tool({
      description: definition.description.slice(0, 2_000),
      inputSchema: z.object({}).catchall(z.unknown()),
      needsApproval: true,
      execute: async (args, options) => {
        let serialized: string;
        try {
          serialized = JSON.stringify(args);
        } catch {
          return { error: "extension tool arguments are not serializable" };
        }
        if (serialized.length > MAX_ARGUMENT_BYTES || Object.keys(args).length > 100) {
          return { error: "extension tool arguments exceeded their limit" };
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abortHandler: (() => void) | undefined;
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("extension tool timed out after 30 seconds")),
              EXECUTION_TIMEOUT_MS,
            );
          });
          const cancelled = new Promise<never>((_, reject) => {
            if (!options.abortSignal) return;
            abortHandler = () => reject(new DOMException("Aborted", "AbortError"));
            if (options.abortSignal.aborted) abortHandler();
            else options.abortSignal.addEventListener("abort", abortHandler, { once: true });
          });
          const execution = definition.execute(args, { signal: options.abortSignal });
          return boundedOutput(await Promise.race([execution, timeout, cancelled]));
        } catch (error) {
          if (options.abortSignal?.aborted) {
            return { error: "extension tool execution was cancelled" };
          }
          return { error: error instanceof Error ? error.message : String(error) };
        } finally {
          if (timer) clearTimeout(timer);
          if (abortHandler) options.abortSignal?.removeEventListener("abort", abortHandler);
        }
      },
    });
  }
  return tools;
}
