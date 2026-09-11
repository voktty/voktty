import type { LanguageModel } from "ai";
import { t } from "@/modules/i18n";
import { runClaudeTextPrompt } from "@/modules/harness/lib/harness/claudeText";
import { runCodexTextPrompt } from "@/modules/harness/lib/harness/codexText";
import { runCursorTextPrompt } from "@/modules/harness/lib/harness/cursorText";
import { runGrokTextPrompt } from "@/modules/harness/lib/harness/grokText";
import { runOpenCodeTextPrompt } from "@/modules/harness/lib/harness/opencodeText";
import { useChatStore } from "@/modules/ai/store/chatStore";

export function createHarnessModel(modelId: string): LanguageModel {
  return new HarnessLanguageModel(modelId) as unknown as LanguageModel;
}

export class HarnessLanguageModel {
  readonly specificationVersion = "v1" as const;
  readonly provider = "harness";
  readonly modelId: string;
  readonly defaultObjectGenerationMode = "json";
  readonly supportsStructuredOutputs = false;

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
  } {
    if (this.modelId.includes("codex")) {
      return {
        binary: "codex",
        labelKey: "agentHistory.agents.codex",
        run: runCodexTextPrompt,
      };
    }
    if (this.modelId.includes("agy") || this.modelId.includes("cursor")) {
      return {
        binary: "cursor-agent",
        labelKey: "agentHistory.agents.cursor",
        run: runCursorTextPrompt,
      };
    }
    if (this.modelId.includes("opencode")) {
      return {
        binary: "opencode",
        labelKey: "agentHistory.agents.opencode",
        run: runOpenCodeTextPrompt,
      };
    }
    if (this.modelId.includes("grok")) {
      return {
        binary: "grok",
        labelKey: "agentHistory.agents.grok",
        run: runGrokTextPrompt,
      };
    }
    return {
      binary: "claude",
      labelKey: "agentHistory.agents.claude",
      run: runClaudeTextPrompt,
    };
  }

  private formatPrompt(prompt: any[]): string {
    const parts: string[] = [];
    for (const msg of prompt) {
      if (!msg) continue;
      const role = msg.role;
      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .map((part: any) =>
            typeof part === "string" ? part : (part?.text ?? ""),
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

  async doGenerate(options: any): Promise<any> {
    const streamResult = await this.doStream(options);
    const reader = streamResult.stream.getReader();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === "text-delta") {
        text += value.textDelta;
      }
    }
    return {
      text,
      finishReason: "stop" as const,
      usage: { promptTokens: 0, completionTokens: 0 },
      rawCall: { rawPrompt: options.prompt, rawSettings: {} },
    };
  }

  async doStream(options: any): Promise<{
    stream: ReadableStream<any>;
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
  }> {
    const { binary, labelKey, run } = this.resolveAgent();
    const formattedPrompt = this.formatPrompt(options.prompt);
    const live = useChatStore.getState().live;
    const cwd = live.getCwd() ?? live.getWorkspaceRoot();

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        try {
          if (!cwd) throw new Error(t("agentHistory.harnessWorkspaceRequired"));
          const text = await run({
            cwd,
            prompt: formattedPrompt,
            timeoutMs: 45_000,
          });
          controller.enqueue({ type: "text-delta", textDelta: text });
        } catch (err: any) {
          const msg = t("agentHistory.harnessExecutionError", {
            agent: t(labelKey),
            error: err?.message || String(err),
            binary,
          });
          controller.enqueue({
            type: "text-delta",
            textDelta: msg,
          });
        }
        controller.enqueue({
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 0, completionTokens: 0 },
        });
        controller.close();
      },
    });

    return {
      stream,
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: {},
      },
    };
  }
}
