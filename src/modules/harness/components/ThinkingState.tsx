import type React from "react";
import { useEffect, useState } from "react";

type ThinkingStateProps = {
  isThinking: boolean;
  thoughtText?: string;
  initialDurationMs?: number;
};

export const ThinkingState: React.FC<ThinkingStateProps> = ({
  isThinking,
  thoughtText,
  initialDurationMs = 0,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [durationMs, setDurationMs] = useState(initialDurationMs);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isThinking) {
      const start = Date.now() - durationMs;
      timer = setInterval(() => {
        setDurationMs(Date.now() - start);
      }, 100);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isThinking]);

  const seconds = (durationMs / 1000).toFixed(1);

  return (
    <div className="my-2 border border-violet-500/20 bg-gradient-to-r from-violet-950/20 via-[#181822]/80 to-violet-950/20 rounded-xl overflow-hidden shadow-sm backdrop-blur-sm transition-all duration-300">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3.5 py-2 flex items-center justify-between text-left hover:bg-white/[0.03] transition-colors group cursor-pointer select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {/* AICSS Shimmering Orb */}
          <div className="relative flex items-center justify-center size-4 shrink-0">
            {isThinking && (
              <span className="absolute inset-0 rounded-full bg-violet-500/40 animate-ping opacity-75" />
            )}
            <span
              className={`size-2.5 rounded-full transition-colors ${
                isThinking
                  ? "bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.8)]"
                  : "bg-violet-500/60"
              }`}
            />
          </div>

          {/* Thinking label with shimmer */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`text-xs font-medium ${
                isThinking
                  ? "text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-white to-violet-300 animate-pulse"
                  : "text-violet-300/80"
              }`}
            >
              {isThinking ? "Thinking & Reasoning..." : "Thought"}
            </span>
            <span className="text-[10px] font-mono text-violet-400/60">
              ({seconds}s)
            </span>
          </div>
        </div>

        {/* Collapsible toggle */}
        <div className="flex items-center gap-1.5 text-white/40 group-hover:text-white/70 transition-colors">
          <span className="text-[10px] font-mono">
            {expanded ? "Hide" : "Details"}
          </span>
          <svg
            className={`w-3.5 h-3.5 transform transition-transform duration-200 ${
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

      {/* Expanded reasoning thought block */}
      {expanded && thoughtText && (
        <div className="px-4 py-3 border-t border-violet-500/10 bg-black/20 text-xs text-white/80 font-mono leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto select-text border-l-2 border-l-violet-500/40 ml-2 mb-2 rounded-r-lg">
          {thoughtText}
        </div>
      )}
    </div>
  );
};
