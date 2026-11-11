import { useMemo, useState } from "react";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import { hostKeyOfProject, useAgentAttention } from "../lib/attentionStore";
import type { FeedTarget } from "../lib/feedSource";
import AgentFeedDialog, { FeedView } from "./AgentFeedDialog";

type SshEnv = Extract<WorkspaceEnv, { kind: "ssh" }>;

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Host path of a team project: `remote://voktty-ssh-<id>/srv/app` -> `/srv/app`. */
function hostPathOf(projectPath: string): string {
  const match = /^remote:\/\/[^/]+(\/.*)$/.exec(projectPath);
  return match ? match[1] : projectPath;
}

/**
 * The communications view of a team tab: what the agents of the team's
 * project say to each other and to the owner. A remote project reads
 * through the SSH session a tab keeps open on its host; it never opens one.
 */
export default function AgentFeedPanel({
  projectPath,
  active,
}: {
  projectPath: string;
  /** The team tab is on screen with this view selected. */
  active: boolean;
}) {
  const { t } = useTranslation();
  const hostKey = hostKeyOfProject(projectPath);
  const liveEnv = useAgentAttention((state) => state.origins[hostKey]?.env);
  const [poppedOut, setPoppedOut] = useState(false);
  const envKey = liveEnv ? JSON.stringify(liveEnv) : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveEnv is compared by value through envKey.
  const target = useMemo<FeedTarget | null>(() => {
    if (hostKey === "local")
      return { kind: "local", root: projectPath, project: lastSegment(projectPath) };
    if (!liveEnv || liveEnv.kind !== "ssh") return null;
    const env = liveEnv as SshEnv;
    const root = hostPathOf(projectPath);
    return {
      kind: "ssh",
      root,
      project: lastSegment(root),
      host: env.connection.name || env.connection.host,
      env,
    };
  }, [hostKey, projectPath, envKey]);

  if (!target) {
    return <p className="p-4 text-muted-foreground text-sm">{t("agentFeed.disconnected")}</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">{t("agentFeed.description")}</p>
        <button
          type="button"
          className="agent-feed-chip cursor-pointer"
          onClick={() => setPoppedOut(true)}
        >
          {t("agentFeed.popOut")}
        </button>
      </div>
      <FeedView target={target} active={active && !poppedOut} initialScope="project" />
      {poppedOut ? (
        <AgentFeedDialog
          open
          onOpenChange={(open) => setPoppedOut(open)}
          root={target.root}
          env={target.kind === "ssh" ? target.env : { kind: "local" }}
        />
      ) : null}
    </div>
  );
}
