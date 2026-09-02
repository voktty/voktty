import React, { useState } from "react";
import type { ToolBlock } from "../types";

type ToolCallBlockProps = {
  block: ToolBlock;
};

export const ToolCallBlock: React.FC<ToolCallBlockProps> = ({ block }) => {
  const [expanded, setExpanded] = useState(false);

  const isRunning = block.status === "running";
  const isFailed = block.status === "failed";

  return (
    <div
      className={`my-2 rounded-xl overflow-hidden transition-all duration-300 text-xs font-mono border ${
        isRunning
          ? "border-blue-500/40 bg-gradient-to-r from-blue-950/20 via-[#16161f] to-blue-950/20 shadow-[0_0_15px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/20"
          : isFailed
            ? "border-rose-500/30 bg-gradient-to-r from-rose-950/20 via-[#16161f] to-rose-950/20"
            : "border-white/10 bg-[#16161a] hover:border-white/20"
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-white/[0.03] transition-colors gap-2 cursor-pointer select-none group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {/* AICSS Status Orb */}
          <div className="relative flex items-center justify-center size-4 shrink-0">
            {isRunning && (
              <span className="absolute inset-0 rounded-full bg-blue-500/40 animate-ping opacity-75" />
            )}
            <span
              className={`size-2.5 rounded-full transition-all ${
                isRunning
                  ? "bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.9)]"
                  : isFailed
                    ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                    : "bg-emerald-400/90"
              }`}
            />
          </div>

          <span
            className={`font-medium truncate ${
              isRunning
                ? "text-blue-200"
                : isFailed
                  ? "text-rose-200"
                  : "text-white/80"
            }`}
          >
            {block.title}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
              isRunning
                ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                : isFailed
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  : "bg-white/5 text-white/40 border border-white/5"
            }`}
          >
            {block.kind}
          </span>

          <svg
            className={`w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transform transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="p-3.5 border-t border-white/5 bg-[#121215]/90 text-[11px] text-white/70 overflow-x-auto max-h-60 overflow-y-auto space-y-2.5">
          {block.preview?.command && (
            <div>
              <span className="text-white/40 select-none block mb-1 text-[10px] uppercase font-semibold">
                Command:
              </span>
              <pre className="p-2.5 bg-black/50 rounded-lg border border-white/5 text-blue-300 select-text">
                {block.preview.command}
              </pre>
            </div>
          )}

          {block.preview?.target && (
            <div>
              <span className="text-white/40 select-none block mb-1 text-[10px] uppercase font-semibold">
                Target:
              </span>
              <span className="text-emerald-300 bg-emerald-950/30 border border-emerald-500/20 px-2 py-1 rounded-md inline-block">
                {block.preview.target}
              </span>
            </div>
          )}

          {block.detail && (
            <div>
              <span className="text-white/40 select-none block mb-1 text-[10px] uppercase font-semibold">
                Output:
              </span>
              <pre className="p-2.5 bg-black/50 rounded-lg border border-white/5 text-white/80 select-text whitespace-pre-wrap leading-relaxed">
                {block.detail}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
