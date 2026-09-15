import {
  Archive,
  ArrowLeft,
  Bot,
  Inbox,
  Keyboard,
  MessageSquare,
  Palette,
  SlidersHorizontal,
  Sparkles,
  type IconComponent,
} from "./icons";
import { useTranslation } from "@/modules/i18n";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import {
  settingsGroupLabel,
  settingsSectionLabel,
} from "../lib/catalogLabels";
import {
  settingsSectionsByGroup,
  type SettingsSectionId,
} from "../lib/settings";

const SECTION_ICONS: Record<SettingsSectionId, IconComponent> = {
  general: SlidersHorizontal,
  appearance: Palette,
  chat: MessageSquare,
  keybindings: Keyboard,
  providers: Bot,
  inbox: Inbox,
  skills: Sparkles,
  archive: Archive,
};

type Props = {
  section: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
  onClose: () => void;
};

/** Body of the project rail while settings are open. */
export function SettingsNav({ section, onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const groups = settingsSectionsByGroup();

  return (
    <>
      <div
        ref={lockOverscroll}
        aria-label={t("harness.chrome.settings")}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-none px-2 pb-2"
      >
        {groups.map(({ id, sections }) => (
          <div key={id} className="flex flex-col gap-0.5">
            <div className="px-2 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-content/40">
              {settingsGroupLabel(t, id)}
            </div>
            {sections.map((item) => (
              <NavRow
                key={item.id}
                label={settingsSectionLabel(t, item.id)}
                icon={SECTION_ICONS[item.id]}
                active={item.id === section}
                onClick={() => onSelect(item.id)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 flex-col gap-px border-t border-border/10 p-2">
        <NavRow label={t("common.back")} icon={ArrowLeft} onClick={onClose} />
      </div>
    </>
  );
}

function NavRow({
  label,
  icon: Icon,
  active = false,
  onClick,
}: {
  label: string;
  icon: IconComponent;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${
        active
          ? "bg-content/10 text-content"
          : "text-content/50 hover:bg-content/5 hover:text-content"
      }`}
    >
      <Icon className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
        {label}
      </span>
    </button>
  );
}
