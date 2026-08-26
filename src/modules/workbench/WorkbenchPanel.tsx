import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  extensionPanels,
  type ExtensionPanelDefinition,
  useExtensionStore,
} from "@/modules/extensions";
import { useTranslation } from "@/modules/i18n";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Delete02Icon,
  Loading03Icon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { useDapStore } from "./dapStore";
import { useTaskStore } from "./taskStore";

type Props = {
  active: boolean;
  root: string | null;
  workspaceKey: string;
  activeFilePath: string | null;
  onNavigate: (path: string, line: number, column: number) => void;
};

type BuiltinTab = "tasks" | "tests" | "debug";

function IconButton({ label, icon, onClick, disabled = false }: {
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="ghost" size="icon-xs" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <HugeiconsIcon icon={icon} size={14} strokeWidth={1.9} />
    </Button>
  );
}

function TaskList({ testsOnly }: { testsOnly: boolean }) {
  const { t } = useTranslation();
  const tasks = useTaskStore((state) => state.tasks);
  const run = useTaskStore((state) => state.run);
  const start = useTaskStore((state) => state.start);
  const visible = testsOnly ? tasks.filter((task) => task.kind === "test") : tasks;
  return (
    <ul className="min-h-0 flex-1 overflow-auto p-2">
      {visible.length === 0 ? (
        <p className="px-2 py-4 text-xs text-muted-foreground">{t(testsOnly ? "workbench.noTests" : "workbench.noTasks")}</p>
      ) : visible.map((task) => {
        const running = run?.taskId === task.id && !run.exited;
        return (
          <li key={task.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void start(task)} disabled={Boolean(run && !run.exited)}>
              <span className="block truncate text-xs text-foreground">{task.label}</span>
              <span className="block truncate font-mono text-[10px] text-muted-foreground">{task.command}</span>
            </button>
            <HugeiconsIcon icon={running ? Loading03Icon : PlayIcon} size={13} className={cn(running && "animate-spin")} />
          </li>
        );
      })}
    </ul>
  );
}

function Output() {
  const { t } = useTranslation();
  const run = useTaskStore((state) => state.run);
  const stop = useTaskStore((state) => state.stop);
  const clear = useTaskStore((state) => state.clearOutput);
  const error = useTaskStore((state) => state.error);
  if (!run && !error) return null;
  return (
    <section className="flex max-h-[42%] min-h-24 flex-col border-t border-border/50" aria-label={t("workbench.output")}>
      <header className="flex h-8 shrink-0 items-center justify-between px-2 text-[10px] text-muted-foreground">
        <span>{run ? t("workbench.outputStatus", { output: t("workbench.output"), status: run.exited ? (run.exitCode === 0 ? t("workbench.passed") : t("workbench.failed")) : t("workbench.running") }) : t("workbench.error")}</span>
        <div className="flex">
          {run && !run.exited ? <IconButton label={t("workbench.stop")} icon={StopIcon} onClick={() => void stop()} /> : null}
          <IconButton label={t("workbench.clear")} icon={Delete02Icon} onClick={clear} />
        </div>
      </header>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-black/20 p-2 font-mono text-[10px] leading-4 text-foreground/80">{error ?? run?.output ?? ""}</pre>
    </section>
  );
}

function TestResults() {
  const { t } = useTranslation();
  const results = useTaskStore((state) => state.testResults);
  if (!results.length) return null;
  return (
    <div className="max-h-[35%] overflow-auto border-t border-border/50 p-2">
      {results.map((result) => (
        <div key={result.id} className="flex gap-2 rounded px-1 py-0.5 text-[11px]">
          <span className={result.status === "passed" ? "text-emerald-500" : result.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
            {result.status === "passed" ? t("workbench.passedMark") : result.status === "failed" ? t("workbench.failedMark") : t("workbench.skippedMark")}
          </span>
          <span className="truncate" title={result.file ? `${result.file} · ${result.name}` : result.name}>{result.name || t("workbench.unnamedTest")}</span>
        </div>
      ))}
    </div>
  );
}

function DebugView({ root, workspaceKey, activeFilePath, onNavigate }: Pick<Props, "root" | "workspaceKey" | "activeFilePath" | "onNavigate">) {
  const { t } = useTranslation();
  const state = useDapStore();
  const [adapter, setAdapter] = useState("");
  const [requestKind, setRequestKind] = useState<"launch" | "attach">("launch");
  const [argumentsJson, setArgumentsJson] = useState("{}");
  const [breakpointPath, setBreakpointPath] = useState(activeFilePath ?? "");
  const [breakpointLine, setBreakpointLine] = useState("1");
  const [expression, setExpression] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const debugStatus = {
    idle: t("workbench.statusIdle"),
    starting: t("workbench.statusStarting"),
    running: t("workbench.statusRunning"),
    stopped: t("workbench.statusStopped"),
    terminated: t("workbench.statusTerminated"),
    error: t("workbench.statusError"),
  }[state.status];

  useEffect(() => { if (activeFilePath) setBreakpointPath(activeFilePath); }, [activeFilePath]);

  const start = async () => {
    if (!root || !adapter.trim()) return;
    try {
      const parsed: unknown = JSON.parse(argumentsJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("workbench.debugArgumentsObject"));
      setConfigError(null);
      await state.start(root, workspaceKey, { adapterCommand: adapter, request: requestKind, arguments: parsed as Record<string, unknown> });
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error));
    }
  };

  const addBreakpoint = () => {
    const line = Number.parseInt(breakpointLine, 10);
    if (breakpointPath.trim() && Number.isInteger(line) && line > 0) void state.addBreakpoint(breakpointPath.trim(), line);
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2 text-xs">
      <section className="space-y-2 rounded-lg border border-border/50 p-2">
        <Input value={adapter} onChange={(event) => setAdapter(event.target.value)} placeholder={t("workbench.adapterCommand")} aria-label={t("workbench.adapterCommand")} disabled={state.sessionId !== null} />
        <div className="flex gap-2">
          <select value={requestKind} onChange={(event) => setRequestKind(event.target.value as "launch" | "attach")} className="h-8 rounded-md border border-border bg-background px-2 text-xs" disabled={state.sessionId !== null} aria-label={t("workbench.debugRequest")}>
            <option value="launch">{t("workbench.launch")}</option><option value="attach">{t("workbench.attach")}</option>
          </select>
          {state.sessionId === null ? (
            <Button size="sm" className="flex-1" onClick={() => void start()} disabled={!root || !adapter.trim()}><HugeiconsIcon icon={PlayIcon} size={13} />{t("workbench.startDebugging")}</Button>
          ) : (
            <Button size="sm" variant="destructive" className="flex-1" onClick={() => void state.stop()}><HugeiconsIcon icon={StopIcon} size={13} />{t("workbench.stop")}</Button>
          )}
        </div>
        <textarea value={argumentsJson} onChange={(event) => setArgumentsJson(event.target.value)} className="h-20 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-[10px]" aria-label={t("workbench.debugArguments")} disabled={state.sessionId !== null} />
        <div className="text-[10px] text-muted-foreground">{t("workbench.debugStatus")}: {debugStatus}</div>
        {configError || state.error ? <p className="text-[10px] text-destructive">{configError ?? state.error}</p> : null}
      </section>

      {state.sessionId !== null ? (
        <div className="my-2 flex items-center justify-center gap-1 rounded-md border border-border/50 py-1">
          <IconButton label={t("workbench.continue")} icon={PlayIcon} onClick={() => void state.control("continue")} disabled={state.status !== "stopped"} />
          <IconButton label={t("workbench.pause")} icon={PauseIcon} onClick={() => void state.control("pause")} disabled={state.status !== "running"} />
          <IconButton label={t("workbench.stepOver")} icon={ArrowRight01Icon} onClick={() => void state.control("next")} disabled={state.status !== "stopped"} />
          <IconButton label={t("workbench.stepIn")} icon={ArrowRight01Icon} onClick={() => void state.control("stepIn")} disabled={state.status !== "stopped"} />
          <IconButton label={t("workbench.stepOut")} icon={ArrowRight01Icon} onClick={() => void state.control("stepOut")} disabled={state.status !== "stopped"} />
        </div>
      ) : null}

      <section className="mt-2 space-y-1">
        <h3 className="font-medium">{t("workbench.breakpoints")}</h3>
        <div className="flex gap-1"><Input value={breakpointPath} onChange={(event) => setBreakpointPath(event.target.value)} placeholder={t("workbench.filePath")} className="min-w-0 flex-1" /><Input value={breakpointLine} onChange={(event) => setBreakpointLine(event.target.value)} inputMode="numeric" className="w-14" aria-label={t("workbench.line")} /><IconButton label={t("workbench.addBreakpoint")} icon={PlayIcon} onClick={addBreakpoint} /></div>
        {state.breakpoints.map((breakpoint) => <div key={`${breakpoint.path}:${breakpoint.line}`} className="flex items-center gap-1 rounded px-1 text-[10px]"><button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onNavigate(breakpoint.path, breakpoint.line, 1)}>{breakpoint.path}:{breakpoint.line}</button><IconButton label={t("workbench.removeBreakpoint")} icon={Cancel01Icon} onClick={() => void state.removeBreakpoint(breakpoint.path, breakpoint.line)} /></div>)}
      </section>

      <section className="mt-3 space-y-1"><h3 className="font-medium">{t("workbench.callStack")}</h3>{state.model.stackFrames.map((frame) => <button key={frame.id} type="button" className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] hover:bg-muted" onClick={() => { void state.selectFrame(frame.id); if (frame.source?.path) onNavigate(frame.source.path, frame.line, frame.column ?? 1); }}>{frame.name} · {frame.source?.name ?? frame.source?.path ?? "?"}:{frame.line}</button>)}</section>
      <section className="mt-3 space-y-1"><h3 className="font-medium">{t("workbench.variables")}</h3>{state.model.scopes.map((scope) => <button key={`${scope.name}:${scope.variablesReference}`} type="button" className="mr-1 rounded bg-muted px-1.5 py-0.5 text-[10px]" onClick={() => void state.loadVariables(scope.variablesReference)}>{scope.name}</button>)}{state.model.variables.map((variable) => <div key={`${variable.name}:${variable.value}`} className="flex gap-2 px-1 text-[10px]"><span className="truncate text-primary">{variable.name}</span><span className="min-w-0 flex-1 truncate font-mono">{variable.value}</span></div>)}</section>
      <section className="mt-3 space-y-1"><h3 className="font-medium">{t("workbench.debugConsole")}</h3><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 font-mono text-[10px]">{state.model.console}</pre><form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); void state.evaluate(expression); setExpression(""); }}><Input value={expression} onChange={(event) => setExpression(event.target.value)} placeholder={t("workbench.evaluateExpression")} /><IconButton label={t("workbench.evaluate")} icon={PlayIcon} onClick={() => { void state.evaluate(expression); setExpression(""); }} /></form></section>
    </div>
  );
}

function ExtensionPanelHost({ panel }: { panel: ExtensionPanelDefinition }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const disposable = panel.mount(ref.current);
    return () => { if (disposable && typeof disposable === "object") disposable.dispose(); ref.current?.replaceChildren(); };
  }, [panel]);
  return <div ref={ref} className="h-full min-h-0 overflow-auto" />;
}

export function WorkbenchPanel({ active, root, workspaceKey, activeFilePath, onNavigate }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<BuiltinTab | `extension:${string}`>("tasks");
  const load = useTaskStore((state) => state.load);
  const pollTasks = useTaskStore((state) => state.poll);
  const taskRun = useTaskStore((state) => state.run);
  const dapSession = useDapStore((state) => state.sessionId);
  const pollDap = useDapStore((state) => state.poll);
  const syncDapWorkspace = useDapStore((state) => state.syncWorkspace);
  useExtensionStore((state) => state.activeExtensions);
  const panels = [...extensionPanels.values()];

  useEffect(() => { if (active) void load(root, workspaceKey); }, [active, load, root, workspaceKey]);
  useEffect(() => {
    if (active) void syncDapWorkspace(root, workspaceKey);
  }, [active, root, syncDapWorkspace, workspaceKey]);
  useEffect(() => {
    if (!active || !taskRun || taskRun.exited) return;
    const timer = window.setInterval(() => void pollTasks(), 250);
    return () => window.clearInterval(timer);
  }, [active, pollTasks, taskRun]);
  useEffect(() => {
    if (!active || dapSession === null) return;
    const timer = window.setInterval(() => void pollDap(), 150);
    return () => window.clearInterval(timer);
  }, [active, dapSession, pollDap]);

  const selectedPanel = tab.startsWith("extension:") ? panels.find((panel) => `extension:${panel.id}` === tab) : null;
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t("workbench.title")}>
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        {(["tasks", "tests", "debug"] as const).map((id) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={cn("rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground", tab === id && "bg-muted text-foreground")}>{t(`workbench.${id}`)}</button>)}
        {panels.map((panel) => <button key={panel.id} type="button" aria-pressed={tab === `extension:${panel.id}`} onClick={() => setTab(`extension:${panel.id}`)} className={cn("max-w-24 truncate rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted", tab === `extension:${panel.id}` && "bg-muted text-foreground")}>{panel.title}</button>)}
        <span className="flex-1" />
        <IconButton label={t("workbench.refresh")} icon={RefreshIcon} onClick={() => void load(root, workspaceKey)} />
      </header>
      {tab === "tasks" ? <><TaskList testsOnly={false} /><Output /></> : null}
      {tab === "tests" ? <><TaskList testsOnly /><TestResults /><Output /></> : null}
      {tab === "debug" ? <DebugView root={root} workspaceKey={workspaceKey} activeFilePath={activeFilePath} onNavigate={onNavigate} /> : null}
      {selectedPanel ? <ExtensionPanelHost panel={selectedPanel} /> : null}
    </section>
  );
}
