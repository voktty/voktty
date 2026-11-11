import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  BookOpen01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTranslation } from "@/modules/i18n";
import type {
  AgentDefinition,
  AgentRoster,
} from "@/modules/workspace-kit/lib/configTypes";
import { deleteAgent } from "../lib/rosterEditor";
import { readRoster, readTeamState } from "../lib/teamFs";
import type { TeamAgentStatus, TeamState } from "../types";
import { AgentFormDialog } from "./AgentFormDialog";
import { RulesDialog } from "./RulesDialog";

const LegacyImportModal = lazy(() =>
  import("./LegacyImportModal").then((m) => ({ default: m.LegacyImportModal }))
);

export type TeamBoardProps = {
  projectPath: string;
  spaceId?: string;
  onNavigateToTab?: (tabId: number) => void;
  onNewHarnessTab?: (
    spaceId?: string,
    cwd?: string,
    sessionId?: string,
  ) => number;
};

const MAX_TEAM_AGENTS = 6;

function resolveAgentModel(
  agent: AgentDefinition,
  roster: AgentRoster,
): string {
  return (
    agent.runtime?.model ??
    roster.defaults?.runtime?.model ??
    "claude-3-7-sonnet"
  );
}

function resolveAgentAdapter(
  agent: AgentDefinition,
  roster: AgentRoster,
): string {
  return (
    agent.runtime?.adapter ?? roster.defaults?.runtime?.adapter ?? "claude"
  );
}

function isModelForbidden(model: string, roster: AgentRoster): boolean {
  const forbidden = roster.policies?.forbiddenModels || [];
  return forbidden.some((f: string) =>
    model.toLowerCase().includes(f.toLowerCase()),
  );
}

export function TeamBoard({
  projectPath,
  spaceId,
  onNavigateToTab,
  onNewHarnessTab,
}: TeamBoardProps) {
  const { t } = useTranslation();
  const [roster, setRoster] = useState<AgentRoster | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [teamState, setTeamState] = useState<TeamState | null>(null);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    isError: boolean;
    message: string;
  } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const loadData = useCallback(async () => {
    const { roster: loadedRoster, error } = await readRoster(projectPath);
    setRoster(loadedRoster);
    setRosterError(error ?? null);
    const state = await readTeamState(projectPath);

    // Sync state with live harness snapshots if available
    try {
      const { getHarnessSessionSnapshot } = await import(
        "@/modules/harness/lib/harnessControlBridge"
      );
      let updated = false;
      const mergedAgents = { ...state.agents };
      for (const [name, agentState] of Object.entries(mergedAgents)) {
        if (agentState.sessionId) {
          const snap = getHarnessSessionSnapshot(agentState.sessionId);
          if (snap) {
            let liveStatus: TeamAgentStatus = "idle";
            if (snap.pendingApproval) {
              liveStatus = "waiting_approval";
            } else if (snap.state === "working") {
              liveStatus = "working";
            }
            if (agentState.status !== liveStatus) {
              mergedAgents[name] = { ...agentState, status: liveStatus };
              updated = true;
            }
          }
        }
      }
      if (updated) {
        state.agents = mergedAgents;
      }
    } catch {
      // In tests or headless environments where bridge is absent
    }

    setTeamState(state);
  }, [projectPath]);

  useEffect(() => {
    void loadData();
    const interval = setInterval(() => {
      void loadData();
    }, 2000);
    return () => clearInterval(interval);
  }, [loadData]);

  const resolveAgentStatus = useCallback(
    (
      agent: AgentDefinition,
      roster: AgentRoster,
      state: TeamState | null,
    ): {
      status: TeamAgentStatus;
      isForbidden: boolean;
      pendingApproval: boolean;
      sessionId?: string;
    } => {
      const model = resolveAgentModel(agent, roster);
      const isForbidden = isModelForbidden(model, roster);

      const agentSaved = state?.agents[agent.name];
      const sessionId = agentSaved?.sessionId;
      const runtimeStatus: TeamAgentStatus = agentSaved?.status ?? "unopened";

      return {
        status: runtimeStatus,
        isForbidden,
        pendingApproval: runtimeStatus === "waiting_approval",
        sessionId,
      };
    },
    [],
  );

  const handleOpen = async (agentName: string, mode: "new" | "resume") => {
    if (!onNewHarnessTab) return;
    setBusyAgent(agentName);
    setFeedback(null);
    try {
      const { openAgent } = await import("../lib/agentLauncher");
      const { newSession } = await import("@/modules/harness/lib/session");
      const { cacheSession } = await import(
        "@/modules/harness/lib/sessionStore"
      );

      const result = await openAgent(
        {
          projectPath,
          agentName,
          mode,
          spaceId,
        },
        {
          onNewHarnessTab,
          newSession,
          cacheSession,
        },
      );

      if (!result.ok) {
        setFeedback({
          isError: true,
          message: result.reason ?? "Failed to open agent",
        });
      } else {
        if (result.tabId && onNavigateToTab) {
          onNavigateToTab(result.tabId);
        }
        await loadData();
      }
    } catch (err: unknown) {
      setFeedback({
        isError: true,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyAgent(null);
    }
  };

  const handleStop = async (agentName: string) => {
    const sessionId = teamState?.agents[agentName]?.sessionId;
    if (!sessionId) return;
    setBusyAgent(agentName);
    try {
      const { interruptHarnessSession } = await import(
        "@/modules/harness/lib/harnessControlBridge"
      );
      interruptHarnessSession(sessionId);
      await loadData();
    } catch (err: unknown) {
      setFeedback({
        isError: true,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyAgent(null);
    }
  };

  const handleGoToTab = (agentName: string) => {
    const sessionId = teamState?.agents[agentName]?.sessionId;
    if (sessionId && onNewHarnessTab) {
      const tabId = onNewHarnessTab(spaceId, projectPath, sessionId);
      if (tabId && onNavigateToTab) {
        onNavigateToTab(tabId);
      }
    }
  };

  const handleDeleteAgent = async (agentName: string) => {
    if (!window.confirm(t("teams.confirmDelete", { name: agentName }))) {
      return;
    }
    setFeedback(null);
    try {
      const res = await deleteAgent(projectPath, agentName);
      if (!res.ok) {
        setFeedback({
          isError: true,
          message: res.error ?? "Failed to delete agent",
        });
      } else {
        await loadData();
      }
    } catch (err: unknown) {
      setFeedback({
        isError: true,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const activeCount = Object.values(teamState?.agents ?? {}).filter(
    (a) =>
      a.status === "working" ||
      a.status === "idle" ||
      a.status === "waiting_approval",
  ).length;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-background p-6">
      <div className="mb-6 flex items-center justify-between border-b pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {t("teams.boardTitle")}
            </h1>
            <Badge variant="outline" className="text-xs">
              {t("teams.agentCount", {
                active: activeCount,
                max: MAX_TEAM_AGENTS,
              })}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setImportOpen(true)}
          >
            <span>{t("teams.importLegacy")}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setRulesOpen(true)}
          >
            <HugeiconsIcon icon={BookOpen01Icon} size={14} />
            <span>{t("teams.editRules")}</span>
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setEditingAgent(null);
              setFormOpen(true);
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
            <span>{t("teams.addAgent")}</span>
          </Button>
        </div>
      </div>

      {feedback && (
        <div
          className={`mb-4 rounded-md border p-3 text-sm ${
            feedback.isError
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-primary/40 bg-primary/10 text-primary"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {rosterError && (
        <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-semibold">{t("teams.invalidRoster")}</p>
          <p className="mt-1 font-mono text-xs">{rosterError}</p>
        </div>
      )}

      {!roster && !rosterError && (
        <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-sm text-muted-foreground">
          <p>{t("teams.emptyRoster")}</p>
          <Button
            size="sm"
            onClick={() => {
              setEditingAgent(null);
              setFormOpen(true);
            }}
          >
            <HugeiconsIcon
              icon={PlusSignIcon}
              size={14}
              strokeWidth={2}
              className="mr-1.5"
            />
            {t("teams.addAgent")}
          </Button>
        </div>
      )}

      {roster && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roster.agents.map((agent) => {
            const { status, isForbidden, pendingApproval } = resolveAgentStatus(
              agent,
              roster,
              teamState,
            );
            const model = resolveAgentModel(agent, roster);
            const adapter = resolveAgentAdapter(agent, roster);
            const isBusy = busyAgent === agent.name;
            const savedAgent = teamState?.agents[agent.name];

            return (
              <Card
                key={agent.name}
                className="flex flex-col justify-between border shadow-sm"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-xs font-semibold">
                        {adapter.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <CardTitle className="text-base font-semibold">
                          {agent.name}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {agent.role}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {status === "waiting_approval" && (
                        <Badge
                          variant="destructive"
                          className="text-xs animate-pulse"
                        >
                          {t("teams.waitingApproval")}
                        </Badge>
                      )}
                      {status === "working" && (
                        <Badge
                          variant="default"
                          className="bg-amber-600 text-xs"
                        >
                          {t("teams.working")}
                        </Badge>
                      )}
                      {status === "idle" && (
                        <Badge variant="secondary" className="text-xs">
                          {t("teams.idle")}
                        </Badge>
                      )}
                      {status === "unopened" && (
                        <Badge
                          variant="outline"
                          className="text-xs text-muted-foreground"
                        >
                          {t("teams.unopened")}
                        </Badge>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title={t("teams.editAgent")}
                        onClick={() => {
                          setEditingAgent(agent);
                          setFormOpen(true);
                        }}
                      >
                        <HugeiconsIcon icon={PencilEdit02Icon} size={13} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title={t("teams.deleteAgent")}
                        onClick={() => void handleDeleteAgent(agent.name)}
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={13} />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pb-3 text-sm">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono text-foreground">{adapter}</span>
                    <span className="font-mono text-foreground">{model}</span>
                  </div>

                  {savedAgent?.task && (
                    <div className="rounded-md bg-muted/50 p-2 text-xs">
                      <p className="line-clamp-2 text-muted-foreground font-sans">
                        <span className="font-semibold text-foreground">
                          {t("teams.taskLabel")}:{" "}
                        </span>
                        {savedAgent.task}
                      </p>
                    </div>
                  )}

                  {savedAgent?.lastVerdict && (
                    <div className="rounded-md border border-border/60 bg-background/50 p-2 text-xs">
                      <span className="font-semibold text-foreground">
                        {t("teams.lastVerdictLabel")}:{" "}
                      </span>
                      <span className="font-mono">
                        {savedAgent.lastVerdict.text}
                      </span>
                    </div>
                  )}

                  {isForbidden && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                      <p className="font-semibold">
                        {t("teams.forbiddenModel", { model })}
                      </p>
                      <p className="mt-0.5 text-xs">
                        {t("teams.forbiddenModelDesc")}
                      </p>
                    </div>
                  )}

                  {pendingApproval && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                      <Button
                        size="sm"
                        variant="link"
                        className="h-auto p-0 text-xs text-amber-700 dark:text-amber-300 underline"
                        onClick={() => handleGoToTab(agent.name)}
                      >
                        {t("teams.resolveApproval")}
                      </Button>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="flex items-center justify-end gap-2 border-t pt-3">
                  {status === "unopened" ? (
                    <Button
                      size="sm"
                      disabled={isBusy || isForbidden}
                      onClick={() => handleOpen(agent.name, "new")}
                    >
                      {t("teams.startNew")}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => handleGoToTab(agent.name)}
                      >
                        {t("teams.goToTab")}
                      </Button>
                      {status === "working" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isBusy}
                          onClick={() => handleStop(agent.name)}
                        >
                          {t("teams.stop")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isBusy || isForbidden}
                        onClick={() => handleOpen(agent.name, "resume")}
                      >
                        {t("teams.resume")}
                      </Button>
                    </>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <AgentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectPath={projectPath}
        initialAgent={editingAgent}
        onSaved={() => void loadData()}
      />
      <RulesDialog
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        projectPath={projectPath}
      />
      {importOpen && (
        <Suspense fallback={null}>
          <LegacyImportModal
            open={importOpen}
            onOpenChange={setImportOpen}
            projectPath={projectPath}
            onImportSuccess={() => void loadData()}
          />
        </Suspense>
      )}
    </div>
  );
}
