import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { redactSensitive } from "@/modules/ai/lib/redact";
import { ProjectMascot } from "@/modules/harness/chrome/ProjectMascot";
import { tabGroupColor } from "@/modules/harness/lib/tabGroups";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { FeedAgent, TimelineItem } from "../lib/feedModel";
import { type FeedTarget, feedTargetFor } from "../lib/feedSource";
import { tmuxAttachCommand } from "../lib/tmux";
import { type FeedStatus, useAgentFeed } from "../lib/useAgentFeed";
import type { FeedScope } from "../lib/types";
import { useAgentAttention } from "../lib/attentionStore";
import { belongsToClosedAgent, closedAgentNames } from "../lib/closedAgents";
import "./agentFeed.css";

const HOUR = 3_600_000;
const RANGES = [
  { ms: 6 * HOUR, key: "agentFeed.range6h" },
  { ms: 24 * HOUR, key: "agentFeed.range24h" },
  { ms: 72 * HOUR, key: "agentFeed.range3d" },
] as const;
const VISIBLE_ITEMS = 400;
const HIDE_CLOSED_KEY = "voktty.agentFeed.hideClosed";

function readHideClosed(): boolean {
  try {
    return localStorage.getItem(HIDE_CLOSED_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeHideClosed(value: boolean) {
  try {
    localStorage.setItem(HIDE_CLOSED_KEY, String(value));
  } catch {
    // Storage is optional; the filter still works for this view.
  }
}
const COLLAPSED_CHARS = 420;

type Filter = "message" | "note" | "human" | "presence";
const FILTERS: readonly { id: Filter; key: string }[] = [
  { id: "message", key: "agentFeed.filterMessages" },
  { id: "note", key: "agentFeed.filterNotes" },
  { id: "human", key: "agentFeed.filterHuman" },
  { id: "presence", key: "agentFeed.filterPresence" },
];

function filterOf(item: TimelineItem): Filter {
  if (item.kind === "joined" || item.kind === "left") return "presence";
  return item.kind;
}

function readLastSeen(key: string): string | null {
  try {
    return localStorage.getItem(`voktty.agentFeed.lastSeen:${key}`);
  } catch {
    return null;
  }
}

function writeLastSeen(key: string, ts: string) {
  try {
    localStorage.setItem(`voktty.agentFeed.lastSeen:${key}`, ts);
  } catch {
    // Private windows and blocked storage only lose the unread marker.
  }
}

type Offset = { x: number; y: number };
const POSITION_KEY = "voktty.agentFeed.position";

function readOffset(): Offset {
  try {
    const parsed = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
    if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y))
      return clampOffset({ x: parsed.x, y: parsed.y });
  } catch {
    // Blocked storage only forgets where the panel was.
  }
  return { x: 0, y: 0 };
}

function writeOffset(offset: Offset) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(offset));
  } catch {
    // Same as above.
  }
}

/** Keeps the panel's header reachable inside the window. */
function clampOffset({ x, y }: Offset): Offset {
  const maxX = Math.max(0, window.innerWidth / 2 - 120);
  const maxY = Math.max(0, window.innerHeight / 2 - 60);
  return {
    x: Math.round(Math.min(maxX, Math.max(-maxX, x))),
    y: Math.round(Math.min(maxY, Math.max(-maxY, y))),
  };
}

/** Drag by the header; double click recentres. Position survives reopening. */
function useMovablePanel() {
  const [offset, setOffset] = useState<Offset>(readOffset);
  const drag = useRef<{ startX: number; startY: number; from: Offset } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    drag.current = { startX: event.clientX, startY: event.clientY, from: offset };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (!start) return;
    setOffset(
      clampOffset({
        x: start.from.x + event.clientX - start.startX,
        y: start.from.y + event.clientY - start.startY,
      }),
    );
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setOffset((current) => {
      writeOffset(current);
      return current;
    });
  };
  const recentre = () => {
    setOffset({ x: 0, y: 0 });
    writeOffset({ x: 0, y: 0 });
  };
  return {
    style: { left: `calc(50% + ${offset.x}px)`, top: `calc(50% + ${offset.y}px)` },
    handle: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick: recentre },
  };
}

function formatTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString([], { day: "2-digit", month: "short" })} ${time}`;
}

export default function AgentFeedDialog({
  open,
  onOpenChange,
  root,
  env,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  root: string | null;
  env: WorkspaceEnv;
}) {
  const { t } = useTranslation();
  const envKey = JSON.stringify(env);
  // biome-ignore lint/correctness/useExhaustiveDependencies: env is compared by value through envKey.
  const target = useMemo(() => feedTargetFor(root, env), [root, envKey]);
  const panel = useMovablePanel();
  // Floating, not modal: the terminal stays usable while the log is open,
  // and clicking it does not close the panel.
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="flex h-[min(86dvh,860px)] flex-col gap-3 p-4 shadow-2xl sm:max-w-4xl"
        style={panel.style}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader
          {...panel.handle}
          className="cursor-move touch-none select-none"
          title={t("agentFeed.moveHint")}
        >
          <DialogTitle>{t("agentFeed.title")}</DialogTitle>
          <DialogDescription>{t("agentFeed.description")}</DialogDescription>
        </DialogHeader>
        {typeof target === "string" ? (
          <p className="text-muted-foreground text-sm">{t(`agentFeed.${target}`)}</p>
        ) : (
          <FeedView target={target} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function FeedView({
  target,
  active = true,
  initialScope = "host",
}: {
  target: FeedTarget;
  /** False while its team tab is hidden: nothing is marked seen then. */
  active?: boolean;
  /** The floating log reads the whole host; a team's log its project. */
  initialScope?: FeedScope;
}) {
  const { t } = useTranslation();
  const [rangeMs, setRangeMs] = useState<number>(RANGES[1].ms);
  const [scope, setScope] = useState<FeedScope>(target.root ? initialScope : "host");
  const [filters, setFilters] = useState<Set<Filter>>(
    () => new Set(["message", "note", "human", "presence"]),
  );
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [hideClosed, setHideClosed] = useState(readHideClosed);
  // Questions the background watcher found on this host: tagged here and
  // marked seen while the log shows them.
  const sourceKey = target.kind === "ssh" ? `ssh:${target.env.connection.id}` : "local";
  const waitingItems = useAgentAttention((state) => state.bySource[sourceKey]);
  const waitingIds = useMemo(
    () => new Set((waitingItems ?? []).map((item) => item.recordId)),
    [waitingItems],
  );
  useEffect(() => {
    if (!active) return;
    const store = useAgentAttention.getState();
    store.setViewing(sourceKey);
    if (waitingItems?.length) store.markSeen(sourceKey);
    return () => {
      if (useAgentAttention.getState().viewing === sourceKey)
        useAgentAttention.getState().setViewing(null);
    };
  }, [active, sourceKey, waitingItems]);
  const [showAll, setShowAll] = useState(false);
  const { timeline, status, unrecognized, key } = useAgentFeed(target, scope, rangeMs);
  const [lastSeen] = useState(() => readLastSeen(key));
  const newest = timeline.items[timeline.items.length - 1];
  const newestTs = useRef<string | null>(null);
  newestTs.current = newest?.ts ?? newestTs.current;
  useEffect(
    () => () => {
      if (newestTs.current) writeLastSeen(key, newestTs.current);
    },
    [key],
  );

  const colors = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of timeline.agents) map.set(agent.name, tabGroupColor(agent.name));
    return map;
  }, [timeline.agents]);
  const colorOf = (name: string) => colors.get(name) ?? tabGroupColor(name);
  const agentByName = useMemo(
    () => new Map(timeline.agents.map((agent) => [agent.name, agent])),
    [timeline.agents],
  );

  const closed = useMemo(() => closedAgentNames(timeline.agents), [timeline.agents]);
  // An agent picked on purpose stays visible even after its session closes.
  const hiding = hideClosed && !(agentFilter && closed.has(agentFilter));
  const agentCards = hiding
    ? timeline.agents.filter((agent) => !closed.has(agent.name))
    : timeline.agents;
  const visible = timeline.items.filter((item) => {
    if (!filters.has(filterOf(item))) return false;
    if (hiding && belongsToClosedAgent(item, closed)) return false;
    if (!agentFilter) return true;
    if (item.kind === "message") return item.from === agentFilter || item.to === agentFilter;
    return item.agent === agentFilter;
  });
  const hidden = showAll ? 0 : Math.max(0, visible.length - VISIBLE_ITEMS);
  const shown = visible.slice(hidden);
  const firstUnread = lastSeen ? shown.findIndex((item) => item.ts > lastSeen) : -1;

  // Stay pinned to the newest entry unless the reader scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  const pulse =
    newest?.kind === "message" ? newest.from : newest?.kind === "note" ? newest.agent : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {target.kind === "ssh"
            ? scope === "host"
              ? t("agentFeed.sourceSshHost", { host: target.host })
              : t("agentFeed.sourceSsh", { project: target.project ?? "", host: target.host })
            : scope === "host"
              ? t("agentFeed.sourceLocalHost")
              : t("agentFeed.sourceLocal", { project: target.project ?? "" })}
        </span>
        <StatusChip status={status} />
        <span className="flex-1" />
        {(["host", "project"] as const).map((option) => (
          <button
            key={option}
            type="button"
            disabled={option === "project" && !target.root}
            title={option === "project" && !target.root ? t("agentFeed.noProject") : undefined}
            className={cn(
              "agent-feed-chip cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
              scope === option ? "text-foreground" : "text-muted-foreground",
            )}
            aria-pressed={scope === option}
            onClick={() => setScope(option)}
          >
            {t(option === "host" ? "agentFeed.scopeHost" : "agentFeed.scopeProject")}
          </button>
        ))}
        <span className="w-2" />
        {RANGES.map((range) => (
          <button
            key={range.ms}
            type="button"
            className={cn(
              "agent-feed-chip cursor-pointer",
              rangeMs === range.ms ? "text-foreground" : "text-muted-foreground",
            )}
            aria-pressed={rangeMs === range.ms}
            onClick={() => setRangeMs(range.ms)}
          >
            {t(range.key)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {agentCards.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            color={colorOf(agent.name)}
            pulseKey={pulse === agent.name ? newest?.id : undefined}
            selected={agentFilter === agent.name}
            onSelect={() => setAgentFilter((current) => (current === agent.name ? null : agent.name))}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          className={cn(
            "agent-feed-chip cursor-pointer",
            hideClosed ? "text-foreground" : "text-muted-foreground opacity-60",
          )}
          aria-pressed={hideClosed}
          disabled={closed.size === 0}
          onClick={() => {
            const next = !hideClosed;
            setHideClosed(next);
            writeHideClosed(next);
          }}
        >
          {t("agentFeed.hideClosed", { count: closed.size })}
        </button>
        <span className="w-2" />
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={cn(
              "agent-feed-chip cursor-pointer",
              filters.has(filter.id) ? "text-foreground" : "text-muted-foreground opacity-60",
            )}
            aria-pressed={filters.has(filter.id)}
            onClick={() =>
              setFilters((current) => {
                const next = new Set(current);
                if (next.has(filter.id)) next.delete(filter.id);
                else next.add(filter.id);
                return next;
              })
            }
          >
            {t(filter.key)}
          </button>
        ))}
      </div>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto pr-2"
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {hidden > 0 && (
          <button
            type="button"
            className="agent-feed-chip mb-3 cursor-pointer text-muted-foreground"
            onClick={() => setShowAll(true)}
          >
            {t("agentFeed.showOlder", { count: hidden })}
          </button>
        )}
        {shown.length === 0 && status.kind === "live" && (
          <p className="text-muted-foreground text-sm">{t("agentFeed.empty")}</p>
        )}
        <ol className="flex flex-col gap-3">
          {shown.map((item, index) => (
            <li key={item.id}>
              {index === firstUnread && <Rule label={t("agentFeed.newSince")} />}
              <Entry
                item={item}
                colorOf={colorOf}
                agentByName={agentByName}
                waiting={waitingIds.has(item.id)}
              />
            </li>
          ))}
        </ol>
      </div>

      {unrecognized > 0 && (
        <p className="text-muted-foreground text-xs">
          {t("agentFeed.unrecognized", { count: unrecognized })}
        </p>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: FeedStatus }) {
  const { t } = useTranslation();
  if (status.kind === "live")
    return <span className="agent-feed-chip text-emerald-500">{t("agentFeed.live")}</span>;
  if (status.kind === "loading")
    return <span className="agent-feed-chip text-muted-foreground">{t("agentFeed.loading")}</span>;
  if (status.kind === "unavailable")
    return <span className="text-muted-foreground">{t("agentFeed.unavailable")}</span>;
  return (
    <span className="text-destructive" title={status.message}>
      {status.reason === "failed"
        ? t("agentFeed.failed", { error: status.message })
        : t(`agentFeed.${status.reason}`)}
    </span>
  );
}

function Mascot({
  name,
  color,
  active = false,
  gone = false,
  size = "size-6",
}: {
  name: string;
  color: string;
  active?: boolean;
  gone?: boolean;
  size?: string;
}) {
  return (
    <span className={cn("agent-feed-mascot inline-flex shrink-0", gone && "agent-feed-gone")}>
      <ProjectMascot project={name} color={color} active={active} className={`${size} shrink-0`} />
    </span>
  );
}

function AgentCard({
  agent,
  color,
  pulseKey,
  selected,
  onSelect,
}: {
  agent: FeedAgent;
  color: string;
  pulseKey?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const command = agent.tmux ? tmuxAttachCommand(agent.tmux) : null;
  const statusKey = {
    busy: "agentFeed.statusBusy",
    idle: "agentFeed.statusIdle",
    shell: "agentFeed.statusShell",
    gone: "agentFeed.statusGone",
    unknown: "agentFeed.statusUnknown",
  }[agent.status];
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1",
        selected ? "agent-feed-chip text-foreground normal-case" : "",
      )}
      style={{ ["--agent-color" as string]: color }}
    >
      <button
        type="button"
        className="flex cursor-pointer items-center gap-2"
        aria-pressed={selected}
        title={t("agentFeed.filterAgent", { agent: agent.name })}
        onClick={onSelect}
      >
        <span key={pulseKey} className={pulseKey ? "agent-feed-pulse inline-flex" : "inline-flex"}>
          <Mascot
            name={agent.name}
            color={color}
            active={agent.status === "busy"}
            gone={agent.status === "gone"}
            size="size-8"
          />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="font-medium text-sm" style={{ color }}>
            {agent.name}
          </span>
          <span className="flex gap-1.5 text-muted-foreground text-[11px]">
            {agent.orchestrator && (
              <span className="text-foreground">{t("agentFeed.orchestrator")}</span>
            )}
            <span>{t(statusKey)}</span>
          </span>
        </span>
      </button>
      {command && (
        <button
          type="button"
          className="agent-feed-chip cursor-pointer text-muted-foreground"
          title={command}
          onClick={() => {
            void navigator.clipboard
              .writeText(command)
              .then(() => toast.success(t("agentFeed.copied")))
              .catch(() => toast.error(command));
          }}
        >
          {t("agentFeed.copyTmux")}
        </button>
      )}
    </div>
  );
}

function Rule({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center gap-2 text-[11px] text-muted-foreground uppercase">
      <span className="agent-feed-rule" />
      <span>{label}</span>
      <span className="agent-feed-rule" />
    </div>
  );
}

function Body({ text, truncated }: { text: string; truncated: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const safe = useMemo(() => redactSensitive(text), [text]);
  const long = safe.length > COLLAPSED_CHARS;
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {long && !open ? (
        <span className="agent-feed-cut">{safe.slice(0, COLLAPSED_CHARS).trimEnd()}</span>
      ) : (
        safe
      )}
      {(long || truncated) && (
        <div className="mt-1 flex gap-2">
          {long && (
            <button
              type="button"
              className="agent-feed-chip cursor-pointer text-muted-foreground"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? t("agentFeed.collapse") : t("agentFeed.expand")}
            </button>
          )}
          {truncated && open && (
            <span className="text-muted-foreground text-xs">{t("agentFeed.truncated")}</span>
          )}
        </div>
      )}
    </div>
  );
}

function Entry({
  item,
  colorOf,
  agentByName,
  waiting = false,
}: {
  item: TimelineItem;
  colorOf: (name: string) => string;
  agentByName: Map<string, FeedAgent>;
  waiting?: boolean;
}) {
  const { t } = useTranslation();
  const gone = (name: string) => agentByName.get(name)?.status === "gone";
  if (item.kind === "joined" || item.kind === "left") {
    return (
      <div className="agent-feed-enter">
        <Rule
          label={t(item.kind === "joined" ? "agentFeed.joined" : "agentFeed.left", {
            agent: item.agent,
            time: formatTime(item.ts),
          })}
        />
      </div>
    );
  }
  if (item.kind === "human") {
    return (
      <div className="agent-feed-enter flex flex-col items-end gap-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("agentFeed.you")}</span>
          <span>{t("agentFeed.toAgent", { agent: item.agent })}</span>
          <span>{formatTime(item.ts)}</span>
        </div>
        <div className="agent-feed-bubble max-w-[85%]" data-side="right">
          <Body text={item.text} truncated={item.truncated} />
        </div>
      </div>
    );
  }
  const speaker = item.kind === "message" ? item.from : item.agent;
  const color = colorOf(speaker);
  return (
    <div className="agent-feed-enter flex gap-2" style={{ ["--agent-color" as string]: color }}>
      <Mascot name={speaker} color={color} gone={gone(speaker)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium" style={{ color }}>
            {speaker}
          </span>
          {item.kind === "message" ? (
            <>
              <span>{">"}</span>
              <Mascot name={item.to} color={colorOf(item.to)} gone={gone(item.to)} size="size-4" />
              <span className="font-medium" style={{ color: colorOf(item.to) }}>
                {item.to}
              </span>
            </>
          ) : (
            <span>{t("agentFeed.toYou")}</span>
          )}
          <span>{formatTime(item.ts)}</span>
          {item.kind === "message" && (
            <span className="agent-feed-chip normal-case">
              {item.delivered ? t("agentFeed.delivered") : t("agentFeed.notDelivered")}
            </span>
          )}
          {waiting && (
            <span className="agent-feed-chip agent-feed-waiting">{t("agentFeed.needsYou")}</span>
          )}
        </div>
        <div
          className="agent-feed-bubble max-w-[92%]"
          data-tone={item.kind === "note" ? "note" : undefined}
          data-pending={item.kind === "message" && !item.delivered ? "true" : undefined}
        >
          {item.kind === "message" && item.summary && (
            <div className="mb-1 font-semibold text-sm">{item.summary}</div>
          )}
          <Body text={item.text} truncated={item.truncated} />
        </div>
      </div>
    </div>
  );
}
