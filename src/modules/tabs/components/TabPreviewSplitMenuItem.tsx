import { useLayoutEffect, useRef } from "react";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useTranslation } from "@/modules/i18n";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import {
  tabPreviewSplitUnavailableReason,
  PREVIEW_SPLIT_COMMAND,
} from "@/modules/tabs/lib/tabPreviewSplitCommand";
import { HugeiconsIcon } from "@hugeicons/react";
import { Globe02Icon } from "@hugeicons/core-free-icons";

export function TabPreviewSplitMenuItem({
  tab,
  onOpen,
  className,
}: {
  tab: Tab;
  onOpen: (id: number) => void;
  className: string;
}) {
  const { t } = useTranslation();
  const spaces = useSpaces((state) => state.spaces);
  const views = useSpaces((state) => state.viewSpaces);
  const limit = usePreferencesStore((state) => state.spaceViewLimit);
  const reason = tabPreviewSplitUnavailableReason(
    tab,
    spaces.find((space) => space.id === tab.spaceId),
    views,
    limit,
  );
  const owner = useRef<object | null>(null);
  const publication = { tab, spaces, views, limit, onOpen, reason };
  useLayoutEffect(() => {
    owner.current = publication;
    return () => {
      if (owner.current === publication) owner.current = null;
    };
  });
  return (
    <ContextMenuItem
      data-command-id={PREVIEW_SPLIT_COMMAND}
      className={className}
      disabled={reason !== null}
      title={reason ? t(reason) : undefined}
      onSelect={() => {
        if (owner.current !== publication || reason) return;
        const state = useSpaces.getState();
        const currentLimit = usePreferencesStore.getState().spaceViewLimit;
        if (
          state.spaces !== spaces ||
          state.viewSpaces !== views ||
          currentLimit !== limit
        )
          return;
        onOpen(tab.id);
      }}
    >
      <HugeiconsIcon
        icon={Globe02Icon}
        size={13}
        strokeWidth={1.75}
        className="text-cyan-400"
      />
      <span className="flex-1">{t("tabs.splitPreview")}</span>
      {reason && (
        <span className="text-[10px] text-muted-foreground">{t(reason)}</span>
      )}
    </ContextMenuItem>
  );
}
