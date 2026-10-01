import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { CreateSkillForm } from "./SkillPicker";
import { SkillDocumentPreview } from "./SkillDocumentPreview";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  createBlankSkill,
  invalidateSkills,
  loadDisabledSkillPaths,
  saveDisabledSkillPaths,
  SKILLS_CHANGE_EVENT,
  type DiscoveredSkill,
} from "../model/skills";

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function SkillsPage({
  cwd,
  header,
}: {
  cwd: string;
  header?: ReactNode;
}): ReactNode {
  const previewId = useId();
  const filterInput = useRef<HTMLInputElement>(null);
  const [skills, setSkills] = useState<DiscoveredSkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [disabledPaths, setDisabledPaths] = useState<string[]>(() =>
    loadDisabledSkillPaths(),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<DiscoveredSkill | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewText(null);
    setPreviewError(null);
    if (!previewSkill) return;

    invoke<{ kind: string; content?: string }>("fs_read_file", {
      path: previewSkill.path,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (!cancelled) setPreviewText(res.content ?? "");
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPreviewError(
            `Could not read SKILL.md. ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewSkill]);

  useEffect(() => {
    let cancelled = false;
    setSkills(null);
    setError(null);

    invoke<DiscoveredSkill[]>("list_skills", { cwd })
      .then((next) => {
        if (cancelled) return;
        setSkills(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, reload]);

  useEffect(() => {
    const onChange = (): void => setDisabledPaths(loadDisabledSkillPaths());
    window.addEventListener(SKILLS_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(SKILLS_CHANGE_EVENT, onChange);
  }, []);

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (skills ?? []).filter(
        (skill) =>
          !needle ||
          skill.name.toLowerCase().includes(needle) ||
          skill.description.toLowerCase().includes(needle) ||
          skill.source.toLowerCase().includes(needle) ||
          skill.path.toLowerCase().includes(needle),
      ),
    [needle, skills],
  );

  const onToggle = (path: string, enabled: boolean): void => {
    const next = enabled
      ? disabledPaths.filter((item) => item !== path)
      : [...disabledPaths, path];
    try {
      saveDisabledSkillPaths(next);
      setActionError(null);
    } catch {
      setActionError("Could not save the skill preference. Try again.");
    }
  };

  const onCreate = (name: string, scope: "project" | "user"): void => {
    setBusy(true);
    setCreateError(null);
    createBlankSkill({ cwd, name, scope })
      .then(() => {
        invalidateSkills();
        window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
        setAdding(false);
        setReload((v) => v + 1);
      })
      .catch((err: unknown) => {
        setCreateError(
          err instanceof Error ? err.message : "Failed to create skill",
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-neutral-100">
      {header}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Skills</h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            Discover, enable, and author agent capabilities loaded via SKILL.md
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReload((v) => v + 1)}
            aria-label="Refresh skills"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md transition-colors"
          >
            <RefreshIcon className="size-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-md transition-colors"
          >
            <PlusIcon className="size-3.5" />
            New Skill
          </button>
        </div>
      </div>

      {actionError ? (
        <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-2 text-xs text-red-400">
          {actionError}
        </div>
      ) : null}

      {adding ? (
        <div className="border-b border-white/10 bg-white/[0.02] px-6 py-4">
          <div className="max-w-md">
            <CreateSkillForm
              query=""
              cwd={cwd}
              error={createError}
              busy={busy}
              onCancel={() => setAdding(false)}
              onCreate={onCreate}
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 bg-white/[0.01]">
        <SearchIcon className="size-4 text-neutral-500" />
        <input
          ref={filterInput}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter skills by name, description, or source…"
          className="w-full bg-transparent text-xs text-white placeholder:text-neutral-500 outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-xs text-neutral-400 hover:text-white"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error ? (
          <div className="text-xs text-red-400">Failed to load skills: {error}</div>
        ) : skills === null ? (
          <div className="text-xs text-neutral-500 py-6 text-center">Scanning skills…</div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-neutral-500 py-8 text-center">
            {query.trim() ? "No skills match your filter." : "No skills found."}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((skill) => {
              const disabled = disabledPaths.includes(skill.path);
              return (
                <div
                  key={skill.path}
                  className={`flex flex-col justify-between p-3.5 rounded-lg border transition-all ${
                    disabled
                      ? "border-white/5 bg-white/[0.02] opacity-60"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-sm font-semibold text-white truncate">
                          /{skill.name}
                        </span>
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-neutral-300 font-medium">
                          {skill.source}
                        </span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={!disabled}
                          onChange={(e) => onToggle(skill.path, e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-7 h-4 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-600" />
                      </label>
                    </div>
                    <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed">
                      {skill.description || "No description provided."}
                    </p>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/5 text-[11px] text-neutral-500">
                    <span className="capitalize">{skill.scope}</span>
                    <button
                      type="button"
                      onClick={() => setPreviewSkill(skill)}
                      className="flex items-center gap-1 text-purple-400 hover:text-purple-300 font-medium transition-colors"
                    >
                      <EyeIcon className="size-3" />
                      Preview
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewSkill ? (
        <div
          role="dialog"
          aria-labelledby={previewId}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        >
          <div className="flex flex-col w-full max-w-2xl max-h-[85vh] rounded-xl border border-white/10 bg-neutral-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div className="min-w-0">
                <h2 id={previewId} className="text-base font-bold text-white truncate">
                  /{previewSkill.name}
                </h2>
                <p className="text-xs text-neutral-400 truncate">{previewSkill.path}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewSkill(null)}
                aria-label="Close preview"
                className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <CloseIcon className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {previewError ? (
                <div className="text-xs text-red-400">{previewError}</div>
              ) : previewText === null ? (
                <div className="text-xs text-neutral-400">Loading SKILL.md…</div>
              ) : (
                <SkillDocumentPreview text={previewText} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
