import { useState, type ReactNode } from "react";
import { Loader } from "./icons";
import { Modal } from "./Modal";
import {
  CHAT_BACKGROUND_OPACITY_MAX,
  CHAT_BACKGROUND_OPACITY_MIN,
  chatBackgroundSrc,
  loadChatBackgroundOpacity,
  loadChatBackgroundPath,
  loadChatBackgroundScope,
  type ChatBackgroundScope,
} from "../lib/appearance";
import {
  clearProjectChatBackground,
  pickAndSaveProjectChatBackground,
  projectChatBackgroundSrc,
} from "../lib/chatBackground";
import {
  clearProjectChatBackgroundSetting,
  loadProjectChatBackground,
  projectChatBackgroundRevision,
  saveProjectChatBackground,
} from "../lib/projectChatBackground";

type Props = {
  project: string;
  name: string;
  onClose: () => void;
};

export function ProjectBackgroundDialog({ project, name, onClose }: Props) {
  const initial = loadProjectChatBackground(project);
  const [path, setPath] = useState(initial?.path ?? null);
  const [opacity, setOpacity] = useState(
    initial?.opacity ?? loadChatBackgroundOpacity(),
  );
  const [scope, setScope] = useState<ChatBackgroundScope>(
    initial?.scope ?? loadChatBackgroundScope(),
  );
  const [revision, setRevision] = useState(projectChatBackgroundRevision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const globalPath = loadChatBackgroundPath();
  const previewSrc = path
    ? projectChatBackgroundSrc(path, revision)
    : chatBackgroundSrc(globalPath);

  const save = (
    nextPath: string,
    nextOpacity: number,
    nextScope: ChatBackgroundScope,
  ) => {
    saveProjectChatBackground(project, {
      path: nextPath,
      opacity: nextOpacity,
      scope: nextScope,
    });
    setRevision(projectChatBackgroundRevision());
  };

  const choose = async () => {
    setBusy(true);
    setError(null);
    try {
      const nextPath = await pickAndSaveProjectChatBackground(project);
      if (!nextPath) return;
      save(nextPath, opacity, scope);
      setPath(nextPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearProjectChatBackground(project);
      clearProjectChatBackgroundSetting(project);
      setPath(null);
      setOpacity(loadChatBackgroundOpacity());
      setScope(loadChatBackgroundScope());
      setRevision(projectChatBackgroundRevision());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const updateOpacity = (percent: number) => {
    const next = Math.min(
      CHAT_BACKGROUND_OPACITY_MAX,
      Math.max(CHAT_BACKGROUND_OPACITY_MIN, percent / 100),
    );
    setOpacity(next);
    if (path) save(path, next, scope);
  };

  const updateScope = (next: ChatBackgroundScope) => {
    setScope(next);
    if (path) save(path, opacity, next);
  };

  return (
    <Modal
      title="Background Image"
      description={`Choose a background image for ${name}`}
      size="sm"
      onClose={onClose}
    >
      <div className="flex flex-col gap-5 p-4">
        <div>
          <div className="overflow-hidden rounded-xl border border-content/10 bg-content/5">
            {previewSrc ? (
              <img
                src={previewSrc}
                alt=""
                draggable={false}
                className="h-56 w-full object-cover"
              />
            ) : (
              <div className="grid h-56 place-items-center text-[12px] text-content/40">
                No background selected
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void choose()}
            disabled={busy}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-content/10 px-2.5 py-1.5 text-[12px] text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-40"
          >
            {busy ? (
              <Loader className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            {path ? "Change image" : "Choose image"}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-content/45">
            {path
              ? "This image overrides the global background for this project."
              : "This project currently follows the global Appearance setting."}
          </p>
          {error ? (
            <p className="mt-1.5 text-[12px] text-red-400">{error}</p>
          ) : null}
        </div>

        <ProjectBackgroundRow label="Show on">
          <div
            role="radiogroup"
            aria-label="Show project background on"
            className="grid w-44 grid-cols-2 gap-0.5 rounded-md border border-content/10 p-0.5 text-[12px]"
          >
            {[
              { value: "empty" as const, label: "Empty only" },
              { value: "all" as const, label: "All sessions" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={scope === option.value}
                onClick={() => updateScope(option.value)}
                className={`rounded-[5px] px-1.5 py-1 ${
                  scope === option.value
                    ? "bg-content/10 text-content"
                    : "text-content/50 hover:text-content"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </ProjectBackgroundRow>

        <ProjectBackgroundRow label="Visibility">
          <div className="flex w-56 items-center gap-3">
            <input
              type="range"
              min={Math.round(CHAT_BACKGROUND_OPACITY_MIN * 100)}
              max={Math.round(CHAT_BACKGROUND_OPACITY_MAX * 100)}
              value={Math.round(opacity * 100)}
              aria-label="Project background visibility"
              className="sidebar-opacity-slider min-w-0 flex-1"
              onChange={(event) => updateOpacity(Number(event.target.value))}
            />
            <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-content">
              {Math.round(opacity * 100)}%
            </span>
          </div>
        </ProjectBackgroundRow>

        {path ? (
          <button
            type="button"
            onClick={() => void removeImage()}
            disabled={busy}
            className="w-full rounded-md border border-content/10 px-2.5 py-1.5 text-[12px] text-red-400 hover:border-red-400/40 hover:bg-red-400/10 disabled:opacity-40"
          >
            Remove background image
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

function ProjectBackgroundRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-content/8 pt-4">
      <span className="text-[13px] font-medium text-content">{label}</span>
      {children}
    </div>
  );
}
