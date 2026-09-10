import type { LanguageModel } from "ai";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function createHarnessModel(modelId: string): LanguageModel {
  return new HarnessLanguageModel(modelId);
}

export class HarnessLanguageModel implements LanguageModel {
  readonly specificationVersion = "v1" as const;
  readonly provider = "harness";
  readonly modelId: string;
  readonly defaultObjectGenerationMode = "json";

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  private resolveAgentBinary(): { binary: string; label: string } {
    if (this.modelId.includes("codex")) {
      return { binary: "codex", label: "Codex" };
    }
    if (this.modelId.includes("agy") || this.modelId.includes("cursor")) {
      return { binary: "cursor", label: "Agy / Cursor" };
    }
    if (this.modelId.includes("opencode")) {
      return { binary: "opencode", label: "OpenCode" };
    }
    if (this.modelId.includes("grok")) {
      return { binary: "grok", label: "Grok" };
    }
    return { binary: "claude", label: "Claude" };
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
          .map((part: any) => (typeof part === "string" ? part : part?.text ?? ""))
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
    const { binary, label } = this.resolveAgentBinary();
    const formattedPrompt = this.formatPrompt(options.prompt);
    const sessionId = `harness-chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });

        let unlistenLine: UnlistenFn | null = null;
        let unlistenExit: UnlistenFn | null = null;

        const cleanup = () => {
          if (unlistenLine) unlistenLine();
          if (unlistenExit) unlistenExit();
        };

        try {
          unlistenLine = await listen<{ sessionId: string; line: string }>(
            "harness_line",
            (event) => {
              if (event.payload.sessionId === sessionId) {
                const chunk = event.payload.line;
                if (chunk) {
                  controller.enqueue({
                    type: "text-delta",
                    textDelta: chunk + "\n",
                  });
                }
              }
            },
          );

          unlistenExit = await listen<{ sessionId: string; code: number | null }>(
            "harness_exit",
            (event) => {
              if (event.payload.sessionId === sessionId) {
                cleanup();
                controller.enqueue({
                  type: "finish",
                  finishReason: "stop",
                  usage: { promptTokens: 0, completionTokens: 0 },
                });
                controller.close();
              }
            },
          );

          // Spawn local CLI agent in print/exec mode
          let args: string[] = [];
          if (binary === "claude") {
            args = ["-p", formattedPrompt, "--print"];
          } else if (binary === "codex") {
            args = ["exec", "-p", formattedPrompt];
          } else {
            args = ["-p", formattedPrompt];
          }

          await invoke("harness_spawn", {
            sessionId,
            command: binary,
            args,
            cwd: null,
          });
        } catch (err: any) {
          cleanup();
          // Fallback message if local CLI is not installed or available
          const msg = `Local ${label} agent execution error: ${err?.message || String(err)}. Ensure '${binary}' CLI is installed and logged in.`;
          controller.enqueue({
            type: "text-delta",
            textDelta: msg,
          });
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: { promptTokens: 0, completionTokens: 0 },
          });
          controller.close();
        }
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
