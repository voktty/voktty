import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "@/modules/i18n";
import { PanelLeft, RotateCcw } from "../chrome/icons";
import { IconButton } from "../chrome/TitleBar";
import { useDragResize } from "../hooks/useDragResize";
import { inboxItemRef, type InboxItem } from "../lib/githubTasks";
import { inboxAskKey } from "../lib/inboxAsk";

export type InboxSessionPortal = { sessionId: string; host: HTMLElement };
let rememberedWidth = 440;

/** Only a destination for the regular session pane; it owns no chat state. */
export function InboxDiscussionPanel({
  item,
  onClose,
  onOpen,
  onRestart,
  onMount,
}: {
  item: InboxItem;
  onClose: () => void;
  onOpen: (item: InboxItem) => Promise<string>;
  onRestart: (item: InboxItem) => Promise<string>;
  onMount: (portal: InboxSessionPortal | null) => void;
}) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const discussion = useRef<{
    key: string;
    isCurrent: () => boolean;
    pending: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const resize = useDragResize({
    min: 360,
    max: () => Math.max(360, window.innerWidth - 650),
    initial: rememberedWidth,
    defaultWidth: 440,
    direction: "left",
    onCommit: (width) => {
      rememberedWidth = width;
    },
  });
  const key = inboxAskKey(item);
  useLayoutEffect(() => {
    let active = true;
    const owner = { key, isCurrent: () => active, pending: true };
    discussion.current = owner;
    setError(null);
    setLoading(true);
    void Promise.resolve()
      .then(() => (active ? onOpen(item) : undefined))
      .then((sessionId) => {
        if (active && sessionId && host.current)
          onMount({ sessionId, host: host.current });
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      })
      .finally(() => {
        if (active) {
          owner.pending = false;
          setLoading(false);
        }
      });
    return () => {
      active = false;
      if (discussion.current === owner) discussion.current = null;
      onMount(null);
    };
    // Metadata refreshes for the same item must not remount its composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onOpen, onMount]);

  return (
    <aside
      ref={resize.setPaneRef}
      aria-label={t("harness.chrome.askAbout", { name: inboxItemRef(item) })}
      className="relative flex min-h-0 shrink-0 flex-col border-l border-content/10 max-[1100px]:absolute max-[1100px]:inset-0 max-[1100px]:z-10 max-[1100px]:!w-auto"
    >
      <div
        role="separator"
        aria-label={t("harness.chrome.resizeDiscussion")}
        aria-orientation="vertical"
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
        className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize max-[1100px]:hidden"
      />
      <header className="flex h-11 shrink-0 items-center border-b border-content/10 px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {t("harness.chrome.askDot", { name: inboxItemRef(item) })}
        </span>
        <IconButton
          label={t("harness.chrome.restartConversation")}
          disabled={loading}
          onClick={() => {
            const owner = discussion.current;
            if (
              !owner ||
              owner.key !== key ||
              !owner.isCurrent() ||
              owner.pending
            )
              return;
            owner.pending = true;
            setLoading(true);
            setError(null);
            const captured = { ...item };
            void Promise.resolve()
              .then(() => (owner.isCurrent() ? onRestart(captured) : undefined))
              .then((sessionId) => {
                if (owner.isCurrent() && sessionId && host.current)
                  onMount({ sessionId, host: host.current });
              })
              .catch((reason) => {
                if (owner.isCurrent()) setError(String(reason));
              })
              .finally(() => {
                if (owner.isCurrent()) {
                  owner.pending = false;
                  setLoading(false);
                }
              });
          }}
        >
          <RotateCcw className="size-3.5" />
        </IconButton>
        <IconButton label={t("harness.chrome.closePanel")} onClick={onClose}>
          <PanelLeft className="size-3.5" />
        </IconButton>
      </header>
      {error ? (
        <p role="alert" className="p-3 text-xs text-red-400">
          {error}
        </p>
      ) : null}
      <div ref={host} className="flex min-h-0 min-w-0 flex-1 flex-col" />
    </aside>
  );
}
