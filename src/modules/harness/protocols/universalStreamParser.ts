import type { HarnessEvent } from "../types";

const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

export class UniversalStreamParser {
  private onEvent: (event: HarnessEvent) => void;
  private isThinking = false;
  private toolBuffer = "";
  private inToolTag = false;

  constructor(onEvent: (event: HarnessEvent) => void) {
    this.onEvent = onEvent;
  }

  feedLine(rawLine: string): void {
    const clean = stripAnsi(rawLine);
    const trimmed = clean.trim();
    if (!trimmed) return;

    // 1. Try parsing structured JSON
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      if (this.handleJson(trimmed)) return;
    }

    // 2. Check XML / Markdown Thinking Tags (<think>, <thought>, <reasoning>)
    if (this.handleThinkingTags(clean)) return;

    // 3. Check Tool Call XML Tags (<tool_call>...</tool_call>)
    if (this.handleToolTags(clean)) return;

    // 4. Default: stream delta based on state
    if (this.isThinking) {
      this.onEvent({ type: "reasoning.delta", text: clean + "\n" });
    } else {
      this.onEvent({ type: "message.delta", text: clean + "\n" });
    }
  }

  private handleJson(jsonStr: string): boolean {
    try {
      const parsed = JSON.parse(jsonStr);

      // Claude events
      if (parsed.type === "content_block_delta" || parsed.type === "assistant_response") {
        const text = parsed.delta?.text || parsed.text || parsed.content || "";
        if (text) this.onEvent({ type: "message.delta", text });
        return true;
      }
      if (parsed.type === "tool_use" || parsed.type === "tool_call") {
        this.onEvent({
          type: "tool.started",
          callId: parsed.id || `tool-${Date.now()}`,
          title: `${parsed.name || "Tool"} (${parsed.input?.path || parsed.input?.command || ""})`,
          kind: parsed.name?.toLowerCase().includes("bash") ? "command" : "write",
          preview: {
            kind: parsed.name?.toLowerCase().includes("bash") ? "command" : "write",
            target: parsed.input?.path || parsed.input?.file_path,
            command: parsed.input?.command,
          },
        });
        return true;
      }
      if (parsed.type === "tool_result") {
        this.onEvent({
          type: "tool.updated",
          callId: parsed.tool_use_id || "",
          status: parsed.is_error ? "failed" : "completed",
          detail: typeof parsed.content === "string" ? parsed.content : JSON.stringify(parsed.content),
        });
        return true;
      }

      // Codex events
      if (parsed.method === "turn/update" || parsed.type === "item/delta") {
        const text = parsed.params?.delta || parsed.text || "";
        if (text) this.onEvent({ type: "message.delta", text });
        return true;
      }
      if (parsed.method === "turn/tool") {
        this.onEvent({
          type: "tool.started",
          callId: parsed.params?.callId || `codex-${Date.now()}`,
          title: parsed.params?.name || "Codex Tool",
        });
        return true;
      }

      // OpenAI / Hermes function calls format
      if (parsed.type === "function_call" || parsed.function_call) {
        const fn = parsed.function_call || parsed;
        this.onEvent({
          type: "tool.started",
          callId: `fn-${Date.now()}`,
          title: fn.name || "Tool",
          preview: {
            kind: fn.name?.includes("bash") ? "command" : "write",
            command: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments),
          },
        });
        return true;
      }

      // Antigravity / Gemini CLI format
      if (parsed.event === "step_update" && parsed.step_update) {
        const step = parsed.step_update;
        if (step.thought_delta) {
          this.onEvent({ type: "reasoning.delta", text: step.thought_delta });
          return true;
        }
        if (step.text_delta) {
          this.onEvent({ type: "message.delta", text: step.text_delta });
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  private handleThinkingTags(line: string): boolean {
    const lower = line.toLowerCase();

    if (lower.includes("<think>") || lower.includes("<thought>") || lower.includes("<reasoning>")) {
      this.isThinking = true;
      const stripped = line.replace(/<(think|thought|reasoning)>/gi, "").trim();
      if (stripped) {
        this.onEvent({ type: "reasoning.delta", text: stripped + "\n" });
      }
      return true;
    }

    if (lower.includes("</think>") || lower.includes("</thought>") || lower.includes("</reasoning>")) {
      const stripped = line.replace(/<\/(think|thought|reasoning)>/gi, "").trim();
      if (stripped) {
        this.onEvent({ type: "reasoning.delta", text: stripped + "\n" });
      }
      this.isThinking = false;
      this.onEvent({ type: "reasoning.completed" });
      return true;
    }

    return false;
  }

  private handleToolTags(line: string): boolean {
    const lower = line.toLowerCase();

    if (lower.includes("<tool_call>") && lower.includes("</tool_call>")) {
      const match = line.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1].trim());
          this.onEvent({
            type: "tool.started",
            callId: `tool-${Date.now()}`,
            title: `${parsed.name || "Tool"}`,
            preview: {
              kind: parsed.name?.toLowerCase().includes("bash") ? "command" : "write",
              target: parsed.arguments?.path || parsed.arguments?.file_path,
              command: parsed.arguments?.command,
            },
          });
          return true;
        } catch {}
      }
    }

    if (lower.includes("<tool_call>")) {
      this.inToolTag = true;
      this.toolBuffer = line.replace(/<tool_call>/gi, "");
      return true;
    }

    if (this.inToolTag) {
      if (lower.includes("</tool_call>")) {
        this.toolBuffer += line.replace(/<\/tool_call>/gi, "");
        this.inToolTag = false;
        try {
          const parsed = JSON.parse(this.toolBuffer.trim());
          this.onEvent({
            type: "tool.started",
            callId: `tool-${Date.now()}`,
            title: `${parsed.name || "Tool"}`,
            preview: {
              kind: parsed.name?.toLowerCase().includes("bash") ? "command" : "write",
              target: parsed.arguments?.path || parsed.arguments?.file_path,
              command: parsed.arguments?.command,
            },
          });
        } catch {}
        this.toolBuffer = "";
        return true;
      } else {
        this.toolBuffer += line + "\n";
        return true;
      }
    }

    return false;
  }
}
