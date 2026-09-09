import { Check } from "./icons";
import type { ReactNode } from "react";
import { useTranslation } from "@/modules/i18n";
import { Popover } from "./Popover";
import {
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  hasActiveSessionFilters,
  type SessionSidebarFilters,
  type SessionTimeFilter,
} from "../lib/sessionFilters";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";

const MENU_WIDTH = 216;

type Props = {
  x: number;
  y: number;
  harnesses: HarnessId[];
  filters: SessionSidebarFilters;
  onChange: (filters: SessionSidebarFilters) => void;
  onClose: () => void;
};

const TIME_OPTIONS: { id: SessionTimeFilter }[] = [
  { id: "all" },
  { id: "today" },
  { id: "7d" },
  { id: "30d" },
];

export function SessionFiltersMenu({
  x,
  y,
  harnesses,
  filters,
  onChange,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const hiddenHarnesses = new Set(filters.hiddenHarnesses);

  const toggleHarness = (harness: HarnessId) => {
    const next = new Set(hiddenHarnesses);
    if (next.has(harness)) next.delete(harness);
    else next.add(harness);
    onChange({ ...filters, hiddenHarnesses: [...next] });
  };

  const setTime = (time: SessionTimeFilter) => {
    onChange({ ...filters, time });
  };

  const toggleStatus = (key: keyof SessionSidebarFilters["status"]) => {
    onChange({
      ...filters,
      status: { ...filters.status, [key]: !filters.status[key] },
    });
  };

  const toggleArchived = () => {
    onChange({ ...filters, showArchived: !filters.showArchived });
    onClose();
  };

  return (
    <Popover
      anchor={{ x, y }}
      gap={0}
      width={MENU_WIDTH}
      maxHeight={480}
      onDismiss={onClose}
      role="menu"
      aria-label={t("harness.chrome.filterSessions")}
      onContextMenu={(event) => event.preventDefault()}
      className="overflow-y-auto overscroll-none p-1"
    >
      <FilterItem
        label={t("harness.chrome.archived")}
        checked={filters.showArchived}
        onClick={toggleArchived}
      />

      <SectionLabel>{t("harness.chrome.status")}</SectionLabel>
      <FilterItem
        label={t("harness.working")}
        checked={filters.status.working}
        onClick={() => toggleStatus("working")}
      />
      <FilterItem
        label={t("harness.chrome.needsApproval")}
        checked={filters.status.needsApproval}
        onClick={() => toggleStatus("needsApproval")}
      />
      <FilterItem
        label={t("harness.chrome.done")}
        checked={filters.status.done}
        onClick={() => toggleStatus("done")}
      />

      <SectionLabel>{t("harness.chrome.time")}</SectionLabel>
      {TIME_OPTIONS.map((option) => (
        <FilterItem
          key={option.id}
          label={t(`harness.chrome.${option.id === "all" ? "allTime" : option.id === "today" ? "today" : option.id === "7d" ? "last7Days" : "last30Days"}`)}
          checked={filters.time === option.id}
          onClick={() => setTime(option.id)}
        />
      ))}

      {harnesses.length > 0 ? (
        <>
          <SectionLabel>{t("harness.chrome.provider")}</SectionLabel>
          {harnesses.map((harness) => (
            <FilterItem
              key={harness}
              label={HARNESS_TITLE[harness]}
              checked={!hiddenHarnesses.has(harness)}
              icon={
                <HarnessIcon harness={harness} className="size-3.5 shrink-0" />
              }
              onClick={() => toggleHarness(harness)}
            />
          ))}
        </>
      ) : null}

      {hasActiveSessionFilters(filters) ? (
        <>
          <div role="separator" className="my-1 h-px bg-content/10" />
          <button
            type="button"
            role="menuitem"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(DEFAULT_SESSION_SIDEBAR_FILTERS)}
            className="flex h-6.5 w-full items-center rounded-md px-2 text-left text-[12.5px] leading-none text-content/70 hover:bg-content/5 hover:text-content"
          >
            {t("harness.chrome.clearFilters")}
          </button>
        </>
      ) : null}
    </Popover>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-content/40">
      {children}
    </div>
  );
}

function FilterItem({
  label,
  checked,
  icon,
  onClick,
}: {
  label: string;
  checked: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex h-6.5 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] leading-none text-content hover:bg-content/5"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked ? (
        <Check className="size-3.5 shrink-0" strokeWidth={2.25} />
      ) : null}
    </button>
  );
}
