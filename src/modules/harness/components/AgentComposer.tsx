import type React from "react";
import { useState, useRef, useEffect } from "react";
import {
  AGENT_MODELS,
  AVAILABLE_MODELS,
  DEFAULT_AGENT_MODELS,
  type HarnessAgentId,
  type ReasoningEffort,
  type RuntimeMode,
} from "../types";
import { ContextMeter } from "./ContextMeter";

type AgentComposerProps = {
  cwd: string;
  harness: HarnessAgentId;
  model: string;
  runtimeMode: RuntimeMode;
  reasoningEffort?: ReasoningEffort;
  contextUsed?: number;
  contextWindow?: number;
  isStreaming?: boolean;
  onHarnessChange: (harness: HarnessAgentId) => void;
  onModelChange: (model: string) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  onSubmit: (text: string) => void;
  onCancel: () => void;
};

const AGENT_OPTIONS: { id: HarnessAgentId; name: string; icon: string }[] = [
  { id: "antigravity", name: "Antigravity (agy)", icon: "✨" },
  { id: "claude", name: "Claude Code", icon: "🧠" },
  { id: "codex", name: "OpenAI Codex", icon: "🤖" },
  { id: "cursor", name: "Cursor CLI", icon: "⚡" },
  { id: "opencode", name: "OpenCode", icon: "🌐" },
];

export const AgentComposer: React.FC<AgentComposerProps> = ({
  cwd: _cwd,
  harness,
  model,
  runtimeMode,
  reasoningEffort = "medium",
  contextUsed,
  contextWindow,
  isStreaming = false,
  onHarnessChange,
  onModelChange,
  onRuntimeModeChange,
  onReasoningEffortChange,
  onSubmit,
  onCancel,
}) => {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const allowedModels = AGENT_MODELS[harness] || [];
  const currentModelInfo =
    allowedModels.find((m) => m.id === model) ||
    AVAILABLE_MODELS.find((m) => m.id === model);

  // Auto-switch model when harness changes to an unsupported model
  useEffect(() => {
    const isSupported = allowedModels.some((m) => m.id === model);
    if (!isSupported && allowedModels.length > 0) {
      const defaultModel = DEFAULT_AGENT_MODELS[harness] || allowedModels[0].id;
      onModelChange(defaultModel);
    }
  }, [harness, model, allowedModels, onModelChange]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200,
      )}px`;
    }
  }, [text]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim() && !isStreaming) {
        onSubmit(text.trim());
        setText("");
      }
    }
  };

  return (
    <div className="p-3 bg-[#16161a] border-t border-white/10 flex flex-col gap-2.5 select-none relative">
      {/* Top Toolbar: Agent, Filtered Real Model, Reasoning Effort, Mode, and Context Meter */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Agent Picker */}
          <div className="relative">
            <select
              value={harness}
              onChange={(e) => onHarnessChange(e.target.value as HarnessAgentId)}
              className="px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10 text-white/90 border border-white/10 rounded-lg outline-none cursor-pointer transition-colors font-medium"
              title="Agent CLI Harness"
            >
              {AGENT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-[#1e1e24] text-white">
                  {opt.icon} {opt.name}
                </option>
              ))}
            </select>
          </div>

          {/* Real Models ONLY for selected agent */}
          <div className="relative">
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10 text-white/90 border border-white/10 rounded-lg outline-none cursor-pointer transition-colors font-mono"
              title={`Models available for ${harness}`}
            >
              {allowedModels.map((m) => (
                <option key={m.id} value={m.id} className="bg-[#1e1e24] text-white font-sans">
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Reasoning / Thinking Level Selector */}
          {onReasoningEffortChange && currentModelInfo?.reasoning && (
            <div className="flex items-center bg-white/5 px-2 py-0.5 rounded-lg border border-white/10 text-[11px] font-medium gap-1">
              <span className="text-white/40 text-[10px]">Thinking:</span>
              {(["off", "low", "medium", "high"] as ReasoningEffort[]).map((eff) => (
                <button
                  key={eff}
                  type="button"
                  onClick={() => onReasoningEffortChange(eff)}
                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold transition-all cursor-pointer ${
                    reasoningEffort === eff
                      ? "bg-violet-600 text-white shadow-sm"
                      : "text-white/50 hover:text-white/80"
                  }`}
                >
                  {eff === "medium" ? "Med" : eff}
                </button>
              ))}
            </div>
          )}

          {/* Runtime Mode Toggle (Plan / Act / Review) */}
          <div className="flex bg-white/5 p-0.5 rounded-lg border border-white/10 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => onRuntimeModeChange("plan")}
              className={`px-2.5 py-0.5 rounded-md transition-all cursor-pointer ${
                runtimeMode === "plan"
                  ? "bg-blue-600 text-white shadow-sm font-semibold"
                  : "text-white/60 hover:text-white/90"
              }`}
            >
              Plan
            </button>
            <button
              type="button"
              onClick={() => onRuntimeModeChange("act")}
              className={`px-2.5 py-0.5 rounded-md transition-all cursor-pointer ${
                runtimeMode === "act"
                  ? "bg-emerald-600 text-white shadow-sm font-semibold"
                  : "text-white/60 hover:text-white/90"
              }`}
            >
              Act
            </button>
            <button
              type="button"
              onClick={() => onRuntimeModeChange("review")}
              className={`px-2.5 py-0.5 rounded-md transition-all cursor-pointer ${
                runtimeMode === "review"
                  ? "bg-purple-600 text-white shadow-sm font-semibold"
                  : "text-white/60 hover:text-white/90"
              }`}
            >
              Review
            </button>
          </div>
        </div>

        {/* Right side: Context Meter */}
        <ContextMeter
          used={contextUsed}
          window={contextWindow || currentModelInfo?.contextWindow}
        />
      </div>

      {/* Input Box with AICSS Active Glow */}
      <div
        className={`relative flex items-end bg-[#121215] rounded-xl overflow-hidden transition-all duration-300 shadow-inner border ${
          isStreaming
            ? "border-blue-500/50 ring-2 ring-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.15)]"
            : "border-white/10 focus-within:border-blue-500/60 focus-within:ring-2 focus-within:ring-blue-500/20"
        }`}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the agent to code, test, fix bugs or refactor... (Press Enter to send, Shift+Enter for newline)"
          rows={1}
          disabled={isStreaming}
          className="w-full px-3.5 py-2.5 bg-transparent text-sm text-white placeholder-white/40 resize-none outline-none max-h-48 leading-relaxed font-sans"
        />

        <div className="p-2 shrink-0 flex items-center gap-1.5">
          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.3)] transition-all cursor-pointer"
              title="Stop Agent"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (text.trim()) {
                  onSubmit(text.trim());
                  setText("");
                }
              }}
              disabled={!text.trim()}
              className="p-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-30 disabled:hover:from-blue-600 disabled:hover:to-indigo-600 text-white shadow-[0_0_10px_rgba(59,130,246,0.25)] transition-all cursor-pointer"
              title="Send Prompt (Enter)"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 10l7-7m0 0l7 7m-7-7v18"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
