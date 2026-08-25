import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { prettyCwd } from "../lib/paths";
import { projectSessionCount } from "../lib/projectData";

type Props = {
  name: string;
  path: string;
  onCancel: () => void;
  onConfirm: (purgeData: boolean) => void;
};

/**
 * Removing a project only drops it from the rail. Its saved chats and
 * appearance outlive that unless the second, opt-in step says otherwise —
 * either way the folder on disk is left alone.
 */
export function RemoveProjectDialog({ name, path, onCancel, onConfirm }: Props) {
  const [purgeData, setPurgeData] = useState(false);
  const [sessions, setSessions] = useState<number | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void projectSessionCount(path).then((count) => {
      if (!cancelled) setSessions(count);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-80">
      <div className="absolute inset-0 bg-black/30" onMouseDown={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Remove ${name}`}
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[22%] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 bg-content/5 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[13px] font-medium leading-tight text-content">
            Remove “{name}”?
          </h2>
          <p className="text-[12px] leading-snug text-content/55">
            It leaves the sidebar but stays on disk, and opening the folder
            again brings it back.
          </p>
          <p className="truncate text-[11px] leading-tight text-content/40">
            {prettyCwd(path)}
          </p>
        </div>

        <label className="flex cursor-default items-start gap-2.5 rounded-md p-2 hover:bg-content/5">
          <input
            type="checkbox"
            checked={purgeData}
            onChange={(event) => setPurgeData(event.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 accent-red-400"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] leading-tight text-content">
              Also delete this project&apos;s data
            </span>
            <span className="block text-[11px] leading-snug text-content/45">
              {dataSummary(sessions)}
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(purgeData)}
            className="rounded-md bg-red-500/20 px-3 py-1.5 text-[12px] font-medium text-red-300 hover:bg-red-500/30"
          >
            {purgeData ? "Remove and delete" : "Remove"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function dataSummary(sessions: number | null): string {
  const settings = "its name, color, icon, and pin";
  if (sessions == null) return `Saved chats plus ${settings}.`;
  if (sessions === 0) return `No saved chats — clears ${settings}.`;
  const chats = sessions === 1 ? "1 saved chat" : `${sessions} saved chats`;
  return `${chats} plus ${settings}.`;
}
