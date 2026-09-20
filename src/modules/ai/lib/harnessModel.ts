import { useChatStore } from "@/modules/ai/store/chatStore";
import { acquireHarnessBridge } from "@/modules/harness/lib/harness/child";
import {
  runClaudeTextPrompt,
  stopClaudeTextPrompt,
} from "@/modules/harness/lib/harness/claudeText";
import {
  runCodexTextPrompt,
  stopCodexTextPrompt,
} from "@/modules/harness/lib/harness/codexText";
import {
  runCursorTextPrompt,
  stopCursorTextPrompt,
} from "@/modules/harness/lib/harness/cursorText";
import {
  runGrokTextPrompt,
  stopGrokTextPrompt,
} from "@/modules/harness/lib/harness/grokText";
import {
  runOpenCodeTextPrompt,
  stopOpenCodeTextPrompt,
} from "@/modules/harness/lib/harness/opencodeText";
import { homeDir } from "@/modules/harness/lib/fs";
import { t } from "@/modules/i18n";
import type { LanguageModel } from "ai";

type HarnessLanguageModelContract = Extract<
  LanguageModel,
  { readonly specificationVersion: "v4" }
>;
type HarnessCallOptions = Parameters<
  HarnessLanguageModelContract["doGenerate"]
>[0];
type HarnessGenerateResult = Awaited<
  ReturnType<HarnessLanguageModelContract["doGenerate"]>
>;
type HarnessStreamResult = Awaited<
  ReturnType<HarnessLanguageModelContract["doStream"]>
>;
type HarnessStreamPart =
  HarnessStreamResult["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

export function createHarnessModel(modelId: string): LanguageModel {
  return new HarnessLanguageModel(modelId);
}

export class HarnessLanguageModel implements HarnessLanguageModelContract {
  readonly specificationVersion = "v4" as const;
  readonly provider = "harness";
  readonly modelId: string;
  readonly supportedUrls = {};

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  private resolveAgent(): {
    binary: string;
    labelKey: string;
    run: (input: {
      cwd: string;
      prompt: string;
      timeoutMs: number;
    }) => Promise<string>;
    stop: () => Promise<void>;
  } {
    if (this.modelId.includes("codex")) {
      return {
        binary: "codex",
        labelKey: "agentHistory.agents.codex",
        run: runCodexTextPrompt,
        stop: stopCodexTextPrompt,
      };
    }
    if (this.modelId.includes("agy") || this.modelId.includes("cursor")) {
      return {
        binary: "cursor-agent",
        labelKey: "agentHistory.agents.cursor",
        run: runCursorTextPrompt,
        stop: stopCursorTextPrompt,
      };
    }
    if (this.modelId.includes("opencode")) {
      return {
        binary: "opencode",
        labelKey: "agentHistory.agents.opencode",
        run: runOpenCodeTextPrompt,
        stop: stopOpenCodeTextPrompt,
      };
    }
    if (this.modelId.includes("grok")) {
      return {
        binary: "grok",
        labelKey: "agentHistory.agents.grok",
        run: runGrokTextPrompt,
        stop: stopGrokTextPrompt,
      };
    }
    return {
      binary: "claude",
      labelKey: "agentHistory.agents.claude",
      run: runClaudeTextPrompt,
      stop: stopClaudeTextPrompt,
    };
  }

  private formatPrompt(prompt: HarnessCallOptions["prompt"]): string {
    const parts: string[] = [];
    for (const msg of prompt) {
      const role = msg.role;
      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .map((part) =>
            "text" in part && typeof part.text === "string" ? part.text : "",
          )
          .filter(Boolean)
          .join("\n");
      }
      if (text) {
        if (role === "system") {
          parts.push(`[System]: ${text}`);
        } else if (role === "user") {
          parts.push(`[User]: ${text}`);
        } else if (role === "assistant") {
          parts.push(`[Assistant]: ${text}`);
        }
      }
    }
    return parts.join("\n\n");
  }

  private async run(options: HarnessCallOptions): Promise<string> {
    const { binary, labelKey, run, stop } = this.resolveAgent();
    const formattedPrompt = this.formatPrompt(options.prompt);
    const live = useChatStore.getState().live;
    const cwd = live.getCwd() ?? live.getWorkspaceRoot() ?? (await homeDir());

    if (!cwd) throw new Error(t("agentHistory.harnessWorkspaceRequired"));

    // The agent's stdout only reaches these runners while the harness event
    // bridge is installed, and until now that only happened as a side effect
    // of a harness tab being mounted. This model also runs from the chat with
    // no harness tab open, and the health check runs in the settings window,
    // which is a separate webview that never mounts one: the child spawned,
    // nothing was ever read back, and the turn sat until its own timeout.
    const releaseBridge = await acquireHarnessBridge();
    try {
      return await this.withAbort(
        options.abortSignal,
        stop,
        run({ cwd, prompt: formattedPrompt, timeoutMs: 45_000 }),
      );
    } catch (error) {
      if (options.abortSignal?.aborted) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        t("agentHistory.harnessExecutionError", {
          agent: t(labelKey),
          error: detail,
          binary,
        }),
      );
    } finally {
      releaseBridge();
    }
  }

  /**
   * The runners take a fixed timeout and know nothing about the caller's
   * signal, so an aborted health check or a cancelled chat turn would leave
   * the UI waiting for a child nobody is listening to any more. Settle on the
   * signal and tear the child down.
   */
  private async withAbort(
    signal: AbortSignal | undefined,
    stop: () => Promise<void>,
    pending: Promise<string>,
  ): Promise<string> {
    if (!signal) return pending;
    if (signal.aborted) {
      void pending.catch(() => undefined);
      void stop().catch(() => undefined);
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error("aborted");
    }
    let onAbort: (() => void) | null = null;
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          onAbort = () => {
            void stop().catch(() => undefined);
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error("aborted"),
            );
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
      void pending.catch(() => undefined);
    }
  }

  async doGenerate(
    options: HarnessCallOptions,
  ): Promise<HarnessGenerateResult> {
    const text = await this.run(options);
    return {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: undefined,
          text: undefined,
          reasoning: undefined,
        },
      },
      warnings: [],
    };
  }

  async doStream(options: HarnessCallOptions): Promise<HarnessStreamResult> {
    const run = () => this.run(options);

    const stream = new ReadableStream<HarnessStreamPart>({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        try {
          const text = await run();
          controller.enqueue({ type: "text-start", id: "text-0" });
          controller.enqueue({
            type: "text-delta",
            id: "text-0",
            delta: text,
          });
          controller.enqueue({ type: "text-end", id: "text-0" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage: {
              inputTokens: {
                total: undefined,
                noCache: undefined,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: {
                total: undefined,
                text: undefined,
                reasoning: undefined,
              },
            },
          });
        } catch (error) {
          controller.enqueue({ type: "error", error });
        }
        controller.close();
      },
    });

    return { stream };
  }
}
