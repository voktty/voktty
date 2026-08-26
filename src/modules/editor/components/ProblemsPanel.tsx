import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  CancelCircleIcon,
  Idea01Icon,
  InformationCircleIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { useDiagnosticsStore } from "../lib/diagnosticsStore";
import {
  collectWorkspaceProblems,
  type IdeProblem,
  type ProblemSeverity,
  summarizeProblems,
} from "../lib/problems";

const ALL_SEVERITIES: ProblemSeverity[] = [
  "error",
  "warning",
  "information",
  "hint",
];
const MAX_VISIBLE_PROBLEMS = 500;

type Props = {
  active: boolean;
  root: string | null;
  onNavigate: (problem: IdeProblem) => void;
};

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function relativePath(path: string, root: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const caseInsensitive = /^[A-Za-z]:\//.test(normalizedRoot);
  const comparablePath = caseInsensitive
    ? normalizedPath.toLocaleLowerCase("en-US")
    : normalizedPath;
  const comparableRoot = caseInsensitive
    ? normalizedRoot.toLocaleLowerCase("en-US")
    : normalizedRoot;
  const prefix = comparableRoot === "/" ? "/" : `${comparableRoot}/`;
  return comparablePath.startsWith(prefix)
    ? normalizedPath.slice(prefix.length)
    : normalizedPath;
}

function severityIcon(severity: ProblemSeverity) {
  if (severity === "error") return CancelCircleIcon;
  if (severity === "warning") return Alert02Icon;
  if (severity === "hint") return Idea01Icon;
  return InformationCircleIcon;
}

function severityClass(severity: ProblemSeverity): string {
  if (severity === "error") return "text-destructive";
  if (severity === "warning") return "text-amber-700 dark:text-amber-400";
  if (severity === "information") return "text-sky-600 dark:text-sky-400";
  return "text-muted-foreground";
}

export function ProblemsPanel({ active, root, onNavigate }: Props) {
  const { t } = useTranslation();
  const documents = useDiagnosticsStore((state) => state.problemDocuments);
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState<Set<ProblemSeverity>>(
    () => new Set(ALL_SEVERITIES),
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const allProblems = useMemo(
    () => (active ? collectWorkspaceProblems(documents, root) : []),
    [active, documents, root],
  );
  const summary = useMemo(() => summarizeProblems(allProblems), [allProblems]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return allProblems.filter((problem) => {
      if (!enabled.has(problem.severity)) return false;
      if (!normalizedQuery) return true;
      return [problem.message, problem.path, problem.source, problem.code].some(
        (value) => value?.toLocaleLowerCase().includes(normalizedQuery),
      );
    });
  }, [allProblems, enabled, query]);
  const visibleProblems = filtered.slice(0, MAX_VISIBLE_PROBLEMS);
  const groups = useMemo(() => {
    const byPath = new Map<string, IdeProblem[]>();
    for (const problem of visibleProblems) {
      const current = byPath.get(problem.path);
      if (current) current.push(problem);
      else byPath.set(problem.path, [problem]);
    }
    return [...byPath.entries()];
  }, [visibleProblems]);

  const severityCounts: Record<ProblemSeverity, number> = {
    error: summary.errors,
    warning: summary.warnings,
    information: summary.information,
    hint: summary.hints,
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={t("problems.title")}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/40 px-2.5">
        <HugeiconsIcon
          icon={Alert02Icon}
          size={14}
          className="text-amber-600 dark:text-amber-400"
        />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {t("problems.title")}
        </span>
        <span className="rounded bg-foreground/[0.055] px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
          {summary.total}
        </span>
      </header>

      <div className="grid shrink-0 grid-cols-4 gap-1 border-b border-border/30 p-1.5">
        {ALL_SEVERITIES.map((severity) => {
          const selected = enabled.has(severity);
          const label = t(`problems.${severity}Count`, {
            count: severityCounts[severity],
          });
          return (
            <button
              key={severity}
              type="button"
              aria-label={label}
              aria-pressed={selected}
              title={label}
              onClick={() =>
                setEnabled((previous) => {
                  const next = new Set(previous);
                  if (next.has(severity)) next.delete(severity);
                  else next.add(severity);
                  return next;
                })
              }
              className={cn(
                "flex h-7 items-center justify-center gap-1 rounded-md text-[10px] tabular-nums outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-primary/40",
                selected
                  ? "bg-foreground/[0.07]"
                  : "text-muted-foreground/45 hover:bg-foreground/[0.035] hover:text-muted-foreground",
              )}
            >
              <HugeiconsIcon
                icon={severityIcon(severity)}
                size={12}
                strokeWidth={2}
                className={selected ? severityClass(severity) : undefined}
              />
              {severityCounts[severity]}
            </button>
          );
        })}
      </div>

      <div className="relative shrink-0 p-2 pb-1.5">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/60"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("problems.filterPlaceholder")}
          className="h-7 rounded-lg pl-7 text-xs"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!root ? (
          <p className="px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground">
            {t("problems.noWorkspace")}
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground">
            {t("problems.empty")}
          </p>
        ) : (
          groups.map(([path, problems]) => {
            const isCollapsed = collapsed.has(path);
            const relative = relativePath(path, root);
            const name = basename(path);
            const parent = relative.slice(
              0,
              Math.max(0, relative.length - name.length),
            );
            return (
              <div
                key={path}
                className="border-b border-border/25 last:border-b-0"
              >
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((previous) => {
                      const next = new Set(previous);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    })
                  }
                  className="flex h-8 w-full items-center gap-1.5 px-2 text-left text-[11px] outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                >
                  <HugeiconsIcon
                    icon={isCollapsed ? ArrowRight01Icon : ArrowDown01Icon}
                    size={11}
                    strokeWidth={2}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="shrink-0 font-medium text-foreground/90">
                    {name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[9px] text-muted-foreground/55">
                    {parent}
                  </span>
                  <span className="shrink-0 tabular-nums text-[9px] text-muted-foreground/70">
                    {problems.length}
                  </span>
                </button>

                {!isCollapsed
                  ? problems.map((problem) => (
                      <button
                        key={problem.id}
                        type="button"
                        title={problem.message}
                        onClick={() => onNavigate(problem)}
                        className="group flex min-h-10 w-full gap-2 px-3 py-1.5 text-left outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                      >
                        <HugeiconsIcon
                          icon={severityIcon(problem.severity)}
                          size={13}
                          strokeWidth={2}
                          className={cn(
                            "mt-0.5 shrink-0",
                            severityClass(problem.severity),
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] leading-4 text-foreground/90">
                            {problem.message}
                          </span>
                          <span className="flex items-center gap-1.5 text-[9px] leading-4 text-muted-foreground/65">
                            <span className="shrink-0 tabular-nums">
                              {t("problems.location", {
                                line: problem.line,
                                column: problem.column,
                              })}
                            </span>
                            {problem.source ? (
                              <span className="truncate">{problem.source}</span>
                            ) : null}
                            {problem.code ? (
                              <span className="shrink-0">{problem.code}</span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    ))
                  : null}
              </div>
            );
          })
        )}
        {filtered.length > MAX_VISIBLE_PROBLEMS ? (
          <p className="px-3 py-2 text-center text-[10px] text-muted-foreground">
            {t("problems.truncated", { count: MAX_VISIBLE_PROBLEMS })}
          </p>
        ) : null}
      </div>
    </section>
  );
}
