import { useEffect, useRef } from "react";
import { redactSensitive } from "@/modules/ai/lib/redact";
import { routeAgentNotification } from "@/modules/agents/lib/route";
import { useTranslation } from "@/modules/i18n";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { leafIds } from "@/modules/terminal/lib/panes";
import { getLeafWorkspaceEnv } from "@/modules/terminal/lib/useTerminalSession";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import {
  type AttentionItem,
  type HostAgent,
  emptyWatchState,
  foldWatch,
  type WatchSource,
  type WatchState,
  watchSources,
} from "../lib/attention";
import { type AttentionOrigin, useAgentAttention } from "../lib/attentionStore";
import { type FeedTarget, pollFeed } from "../lib/feedSource";

/** Background cadence per host; one poll is a few reads of new bytes. */
export const WATCH_INTERVAL_MS = 20_000;
const LOOKBACK_MS = 6 * 60 * 60 * 1000;
/** Catch-up polls in a row when a host has more to read than one poll returns. */
const MAX_CATCH_UP = 8;

function targetOf(source: WatchSource): FeedTarget {
  return source.env.kind === "ssh"
    ? { kind: "ssh", root: null, project: null, host: source.label, env: source.env }
    : { kind: "local", root: null, project: null };
}

/** One candidate per terminal pane, with the environment it runs in now. */
function sourcesOf(tabs: readonly Tab[]): WatchSource[] {
  return watchSources(
    tabs.flatMap((tab) =>
      tab.kind === "terminal"
        ? leafIds(tab.paneTree).map((leafId) => ({
            env: getLeafWorkspaceEnv(leafId) ?? tab.workspaceEnv ?? LOCAL_WORKSPACE,
            tabId: tab.id,
            leafId,
          }))
        : [],
    ),
  );
}

function preview(text: string): string {
  const flat = redactSensitive(text).replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
}

/**
 * Follows every host behind the open tabs and reports agents that wait for
 * the owner, even when their tab is in the background. Renders nothing.
 * Reads only: never writes to Claude's files and never opens a connection.
 * The hosts are re-read from the tabs on every round, so opening or closing
 * a connection needs no restart.
 */
export default function AgentFeedWatcher({
  getTabs,
  onOpen,
}: {
  /** The open tabs, read on every round. */
  getTabs: () => readonly Tab[];
  /** The host the log is showing right now, if it is open. */
  /** Opens the team of the waiting agent's project on its communications. */
  onOpen: (origin: AttentionOrigin, item: AttentionItem) => void;
}) {
  const { t } = useTranslation();
  const latest = useRef({ t, onOpen, getTabs });
  latest.current = { t, onOpen, getTabs };

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    const states = new Map<string, WatchState>();
    const announced = new Set<string>();

    const notify = (source: WatchSource, item: AttentionItem) => {
      const { t: tr, onOpen: open } = latest.current;
      const viewing = useAgentAttention.getState().viewing;
      routeAgentNotification({
        source: "terminal",
        agent: item.agent,
        kind: "attention",
        title: item.host
          ? tr("agentFeed.waitingTitleHost", { agent: item.agent, host: item.host })
          : tr("agentFeed.waitingTitle", { agent: item.agent }),
        body: preview(item.text),
        focused: document.hasFocus(),
        visible: viewing === source.key,
        allowToast: true,
        tabId: source.tabId,
        leafId: source.leafId,
        onActivate: () =>
          open(
            { key: source.key, env: source.env, tabId: source.tabId, leafId: source.leafId },
            item,
          ),
      });
    };

    const watchOnce = async (source: WatchSource) => {
      const known = states.get(source.key);
      let state = known ?? emptyWatchState();
      let waiting: AttentionItem[] = [];
      let agents: HostAgent[] = [];
      for (let round = 0; round < MAX_CATCH_UP; round += 1) {
        const response = await pollFeed(
          targetOf(source),
          { root: "", scope: "host", sinceMs: Date.now() - LOOKBACK_MS, cursor: state.cursor },
          { recover: false },
        );
        if (disposed || !response.available) return;
        ({ state, waiting, agents } = foldWatch(state, response, source));
        if (!response.truncated) break;
      }
      states.set(source.key, state);
      useAgentAttention.getState().setWaiting(
        source.key,
        waiting,
        { key: source.key, env: source.env, tabId: source.tabId, leafId: source.leafId },
        agents,
      );
      for (const item of waiting) {
        if (announced.has(item.recordId)) continue;
        announced.add(item.recordId);
        // What already waited when the host was first read only shows in
        // the badge: a burst of old questions at launch is noise.
        if (known) notify(source, item);
      }
    };

    const round = async () => {
      const sources = sourcesOf(latest.current.getTabs());
      const keys = new Set(sources.map((source) => source.key));
      const store = useAgentAttention.getState();
      for (const key of Object.keys(store.bySource)) if (!keys.has(key)) store.dropSource(key);
      for (const key of [...states.keys()]) if (!keys.has(key)) states.delete(key);
      await Promise.all(
        sources.map((source) =>
          watchOnce(source).catch(() => {
            // A dropped connection or an outdated helper: try next round.
            // The host keeps its last known state until its tab closes.
          }),
        ),
      );
      if (!disposed) timer = window.setTimeout(round, WATCH_INTERVAL_MS);
    };
    timer = window.setTimeout(round, 0);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
