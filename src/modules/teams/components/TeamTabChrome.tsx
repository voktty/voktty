import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/modules/i18n";
import { getTabPath } from "@/modules/tabs/lib/tabMetadata";
import type { TeamContextMenuProps } from "@/modules/teams/components/TeamTabChromeLazy";
import { UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function TeamTabIcon() {
  return (
    <HugeiconsIcon
      icon={UserGroupIcon}
      size={14}
      strokeWidth={2}
      className="shrink-0 text-cyan-400"
    />
  );
}

export function TeamContextMenuItem({
  tab,
  onOpen,
  className,
}: TeamContextMenuProps) {
  const { t } = useTranslation();
  return (
    <ContextMenuItem
      className={className}
      onSelect={() => onOpen(getTabPath(tab) ?? undefined)}
    >
      <HugeiconsIcon icon={UserGroupIcon} size={13} strokeWidth={1.75} />
      <span className="flex-1">{t("teams.openBoardTabMenu")}</span>
    </ContextMenuItem>
  );
}

export function TeamNewTabMenuItem({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenuItem
      onSelect={onOpen}
      className="flex min-h-7.5 cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-normal text-foreground/90 transition-colors hover:bg-accent/80 hover:text-foreground focus:bg-accent/80 focus:text-foreground"
    >
      <HugeiconsIcon
        icon={UserGroupIcon}
        size={14}
        strokeWidth={1.75}
        className="shrink-0 text-amber-400"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{t("teams.openBoardTabMenu")}</span>
      </span>
    </DropdownMenuItem>
  );
}
