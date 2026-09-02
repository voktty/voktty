import React from "react";
import type { CheckpointStatus } from "../types";

type SessionReviewProps = {
  checkpoint: CheckpointStatus | null | undefined;
  onUndo: () => void;
  onKeep: () => void;
  isReverting?: boolean;
};

export const SessionReview: React.FC<SessionReviewProps> = ({
  checkpoint,
  onUndo,
  onKeep,
  isReverting = false,
}) => {
  if (!checkpoint || checkpoint.files.length === 0) {
    return null;
  }

  const { files, totalAdditions, totalDeletions } = checkpoint;

  return (
    <div className="mx-4 my-2 p-3 bg-[#1e1e24] border border-white/10 rounded-xl shadow-lg flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white/90">
            Turn Changes
          </span>
          <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-white/10 text-white/70">
            {files.length} {files.length === 1 ? "file" : "files"}
          </span>
          <span className="text-[11px] font-mono text-emerald-400">
            +{totalAdditions}
          </span>
          <span className="text-[11px] font-mono text-rose-400">
            -{totalDeletions}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onUndo}
            disabled={isReverting}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Revert all changes made during this turn"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
              />
            </svg>
            Undo Turn
          </button>

          <button
            type="button"
            onClick={onKeep}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-colors flex items-center gap-1.5"
            title="Keep changes and discard checkpoint snapshot"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            Keep
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
        {files.map((file) => {
          let statusBadgeClass = "bg-amber-500/15 text-amber-300 border-amber-500/30";
          if (file.status === "added") {
            statusBadgeClass = "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
          } else if (file.status === "deleted") {
            statusBadgeClass = "bg-rose-500/15 text-rose-300 border-rose-500/30";
          }

          return (
            <div
              key={file.relative}
              className={`px-2 py-0.5 text-[11px] font-mono rounded border flex items-center gap-1.5 ${statusBadgeClass}`}
            >
              <span>{file.relative}</span>
              {file.additions > 0 && (
                <span className="text-emerald-400">+{file.additions}</span>
              )}
              {file.deletions > 0 && (
                <span className="text-rose-400">-{file.deletions}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
