import { Check, CircleAlert } from "lucide-react";
import { basename } from "../lib/fs";
import { inboxItems, type InboxItem } from "../lib/inbox";
import { resolveModel } from "../lib/models";
import { sessionDisplayTitle, type Session } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { TerminalSpinner } from "./TerminalSpinner";

type Props = {
  width: number;
  sessions: Session[];
  approvalSessionIds: Set<string>;
  doneSessionIds: Set<string>;
  busySessionIds: Set<string>;
  activeSessionId?: string;
  onSelectSession: (sessionId: string) => void;
};

export function InboxPanel({
  width,
  sessions,
  approvalSessionIds,
  doneSessionIds,
  busySessionIds,
  activeSessionId,
  onSelectSession,
}: Props) {
  const items = inboxItems(sessions, approvalSessionIds, doneSessionIds);

  return (
    <aside
      aria-label="Inbox"
      style={{ width }}
      className="sidebar-glass relative flex h-full min-h-0 shrink-0 flex-col border-r border-content/10"
    >
      <div className="flex h-9.75 shrink-0 items-center border-b border-content/10 px-3">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-content/50 uppercase">
          Inbox
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        {items.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-content/50">
            Nothing needs your attention
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5 p-1.5">
            {items.map((item) => (
              <li key={item.session.id}>
                <InboxSessionCard
                  item={item}
                  isActive={item.session.id === activeSessionId}
                  busy={busySessionIds.has(item.session.id)}
                  onSelect={onSelectSession}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function InboxSessionCard({
  item,
  isActive,
  busy,
  onSelect,
}: {
  item: InboxItem;
  isActive: boolean;
  busy: boolean;
  onSelect: (sessionId: string) => void;
}) {
  const { session, kind } = item;
  const title = sessionDisplayTitle(session.title, session.harness);
  const project = basename(session.cwd);
  const model = resolveModel(session.harness, session.model).name;
  const needsApproval = kind === "approval";
  const done = kind === "done";

  return (
    <button
      type="button"
      title={title}
      aria-current={isActive ? "true" : undefined}
      onClick={() => onSelect(session.id)}
      className={`border flex w-full flex-col rounded-md px-2.5 py-2 text-left ${
        needsApproval
          ? "bg-content/20 text-content border-content/30 border-dashed"
          : isActive
            ? "bg-content/10 text-content border-transparent"
            : "text-content/80 hover:bg-content/5 hover:text-content border-transparent"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate text-[11px] text-content/50">
            {project}
          </span>
        </span>
        <span
          className={`flex shrink-0 items-center gap-1 text-[11px] tabular-nums ${
            needsApproval
              ? "text-amber-400"
              : busy
                ? "text-accent"
                : done
                  ? "text-emerald-400"
                  : "text-content/45"
          }`}
        >
          {needsApproval ? (
            <>
              <CircleAlert className="size-3" strokeWidth={1.75} />
              <span>Need approval</span>
            </>
          ) : busy ? (
            <>
              <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-accent" />
              <span>Working...</span>
            </>
          ) : done ? (
            <>
              <Check className="size-3" strokeWidth={2.25} />
              <span>Done</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="mt-1 line-clamp-1 text-[13px] font-semibold leading-snug text-content">
        {title}
      </span>
      <span className="mt-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-content/45">
          {model}
        </span>
        <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
      </span>
    </button>
  );
}
