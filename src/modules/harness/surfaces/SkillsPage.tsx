import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "@/modules/i18n";
import {
  Check,
  Copy,
  FolderOpen,
  FoldVertical,
  RefreshCw,
  Search,
  UnfoldVertical,
} from "../chrome/icons";
import { CreateSkillForm } from "../chrome/SkillPicker";
import { copyText } from "../lib/clipboard";
import { listSkills, readTextFile, type DiscoveredSkill } from "../lib/fs";
import {
  CREATE_SKILL_BODY,
  createBlankSkill,
  invalidateSkills,
  loadDisabledSkillPaths,
  saveDisabledSkillPaths,
  SKILLS_CHANGE_EVENT,
} from "../lib/skills";

/** Inspect and manage file skills without modifying provider-owned catalogs. */
export function SkillsPage({ cwd }: { cwd: string }): ReactNode {
  const { t } = useTranslation();
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

  useEffect(() => {
    let cancelled = false;
    setSkills(null);
    setError(null);
    listSkills(cwd)
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
      setActionError(t("skillsPage.savePreferenceError"));
    }
  };

  const onReveal = (path: string): void => {
    setActionError(null);
    void revealItemInDir(path).catch((err: unknown) => {
      setActionError(
        t("skillsPage.openFolderError", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  };

  const onCopyPath = (path: string): void => {
    setActionError(null);
    void copyText(path).catch(() => {
      setActionError(t("skillsPage.copyPathError"));
    });
  };

  const onCreate = (name: string, scope: "project" | "user"): void => {
    setBusy(true);
    setCreateError(null);
    void createBlankSkill({ cwd, name, scope })
      .then(() => {
        invalidateSkills();
        window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
        setAdding(false);
        setReload((value) => value + 1);
      })
      .catch((err: unknown) => {
        setCreateError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="shrink-0 text-[12px] text-content/40 tabular-nums">
            {skills == null
              ? "…"
              : `${filtered.length} ${filtered.length === 1 ? "skill" : "skills"}`}
          </span>
          <label className="flex h-7 w-52 min-w-0 flex-1 items-center gap-2 rounded-md border border-content/10 px-2 text-content/45 focus-within:border-content/20">
            <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("skillsPage.filterPlaceholder")}
              aria-label={t("skillsPage.filterAriaLabel")}
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
            />
          </label>
          <button
            type="button"
            aria-label={t("skillsPage.refreshSkills")}
            title={t("skillsPage.refreshTooltip")}
            disabled={skills === null && !error}
            onClick={() => {
              invalidateSkills();
              window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
              setReload((value) => value + 1);
            }}
            className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content cursor-pointer"
          >
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label={
              adding
                ? t("skillsPage.closeSkillFormAriaLabel")
                : t("skillsPage.addSkillAriaLabel")
            }
            disabled={busy}
            className="rounded-md border border-content/10 px-2.5 py-1 text-[12px] text-content/70 hover:bg-content/10 disabled:opacity-40 cursor-pointer"
            onClick={() => {
              setAdding((value) => !value);
              setCreateError(null);
            }}
            title={t("skillsPage.addSkillTooltip")}
          >
            {adding ? t("skillsPage.closeForm") : t("skillsPage.addSkill")}
          </button>
        </div>
      </div>

      {adding ? (
        <div className="mb-4 overflow-hidden rounded-lg border border-content/10 bg-content/[0.03]">
          <CreateSkillForm
            key={cwd}
            query={query}
            cwd={cwd}
            error={createError}
            busy={busy}
            onCancel={() => {
              setAdding(false);
              setCreateError(null);
            }}
            onCreate={onCreate}
          />
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="pb-3 text-[12px] text-red-400">
          {actionError}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[12px] text-red-400">
          {error}
        </p>
      ) : skills == null ? (
        <p className="text-[12px] text-content/45">{t("skillsPage.loading")}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-content/10">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-content/45">
              {skills.length === 0
                ? t("skillsPage.noSkills")
                : t("skillsPage.noMatchingSkills")}
            </p>
          ) : (
            filtered.map((skill) => {
              const disabled = disabledPaths.includes(skill.path);
              return (
                <SkillRowItem
                  key={skill.path}
                  skill={skill}
                  disabled={disabled}
                  onToggle={onToggle}
                  onReveal={onReveal}
                  onCopyPath={onCopyPath}
                />
              );
            })
          )}
        </div>
      )}

      <p className="pt-3 text-[12px] text-content/40">
        {t("skillsPage.descriptionFooter")}
      </p>
    </>
  );
}

function SkillRowItem({
  skill,
  disabled,
  onToggle,
  onReveal,
  onCopyPath,
}: {
  skill: DiscoveredSkill;
  disabled: boolean;
  onToggle: (path: string, enabled: boolean) => void;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current != null) {
        window.clearTimeout(copyTimer.current);
      }
    };
  }, []);

  const togglePreview = (): void => {
    const next = !expanded;
    setExpanded(next);
    if (next && content === null && !loading) {
      if (skill.scope === "builtin") {
        setContent(CREATE_SKILL_BODY);
        return;
      }
      setLoading(true);
      setLoadError(null);
      readTextFile(skill.path)
        .then((text) => {
          setContent(text);
          setLoadError(null);
        })
        .catch((err: unknown) => {
          setLoadError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          setLoading(false);
        });
    }
  };

  const handleCopyContent = (): void => {
    if (!content) return;
    void copyText(content).then(() => {
      setCopied(true);
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className={`border-b border-content/5 px-3 py-2 last:border-b-0 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate font-sans text-[12px] text-content"
          title={skill.name}
        >
          {skill.name}
        </span>
        <span className="shrink-0 rounded-full bg-content/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-content/60">
          {skill.scope === "user"
            ? t("skillsPage.scopePersonal")
            : skill.scope === "builtin"
              ? t("skillsPage.scopeBuiltin")
              : t("skillsPage.scopeProject")}
        </span>
        <span className="w-20 shrink-0 truncate text-right font-sans text-[11px] text-content/40">
          {skill.source}
        </span>
        <button
          type="button"
          role="switch"
          aria-label={t("skillsPage.toggleAriaLabel", {
            name: skill.name,
          })}
          aria-checked={!disabled}
          onClick={() => onToggle(skill.path, disabled)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer ${disabled ? "bg-content/20" : "bg-sky-500"}`}
        >
          <span
            className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${disabled ? "left-0.5" : "left-4.5"}`}
          />
        </button>
      </div>
      {skill.description ? (
        <p
          className="mt-0.5 truncate text-[12px] text-content/55"
          title={skill.description}
        >
          {skill.description}
        </p>
      ) : null}
      <div className="mt-0.5 flex items-center gap-1">
        <p
          className="min-w-0 flex-1 truncate font-sans text-[11px] text-content/35"
          title={skill.path}
        >
          {skill.path}
        </p>
        <button
          type="button"
          aria-label={t("skillsPage.previewAriaLabel", {
            name: skill.name,
          })}
          title={expanded ? t("skillsPage.hideSkillPreview") : t("skillsPage.previewSkill")}
          onClick={togglePreview}
          className={`grid size-5 shrink-0 place-items-center rounded transition-colors cursor-pointer ${
            expanded
              ? "bg-content/15 text-content"
              : "text-content/40 hover:bg-content/10 hover:text-content"
          }`}
        >
          {expanded ? (
            <FoldVertical className="size-3" strokeWidth={1.75} />
          ) : (
            <UnfoldVertical className="size-3" strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          aria-label={t("skillsPage.copyPathAriaLabel", {
            name: skill.name,
          })}
          title={t("skillsPage.copyPath")}
          onClick={() => onCopyPath(skill.path)}
          className="grid size-5 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content cursor-pointer"
        >
          <Copy className="size-3" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label={t("skillsPage.revealAriaLabel", {
            name: skill.name,
          })}
          title={t("skillsPage.revealInFileManager")}
          onClick={() => onReveal(skill.path)}
          className="grid size-5 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content cursor-pointer"
        >
          <FolderOpen className="size-3" strokeWidth={1.75} />
        </button>
      </div>
      {expanded ? (
        <div className="mt-2 rounded-md border border-content/10 bg-content/[0.03] p-2.5">
          <div className="flex items-center justify-between pb-1.5 border-b border-content/5">
            <span className="text-[11px] font-medium text-content/60">
              {t("skillsPage.previewSkill")}
            </span>
            {content ? (
              <button
                type="button"
                aria-label={t("skillsPage.copySkillContentAriaLabel", {
                  name: skill.name,
                })}
                title={copied ? t("skillsPage.copiedSkillContent") : t("skillsPage.copySkillContent")}
                onClick={handleCopyContent}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-content/50 hover:bg-content/10 hover:text-content cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="size-2.5 text-emerald-400" strokeWidth={2} />
                    <span>{t("skillsPage.copiedSkillContent")}</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-2.5" strokeWidth={1.75} />
                    <span>{t("skillsPage.copySkillContent")}</span>
                  </>
                )}
              </button>
            ) : null}
          </div>
          {loading ? (
            <p className="py-2 text-[11px] text-content/40">
              {t("skillsPage.loading")}
            </p>
          ) : loadError ? (
            <p role="alert" className="py-2 text-[11px] text-red-400">
              {t("skillsPage.loadSkillError", { error: loadError })}
            </p>
          ) : content ? (
            <pre className="mt-1.5 max-h-64 overflow-y-auto rounded bg-content/5 p-2 font-mono text-[11px] leading-4 text-content/80 whitespace-pre-wrap select-text">
              {content}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
