import {
  AppWindow,
  ChevronRight,
  ImagePlus,
  Pipette,
  SquarePlus,
  Trash2,
  Ungroup,
  X,
  type IconComponent,
} from "./icons";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "@/modules/i18n";
import { normalizeHex } from "../lib/colorUtils";
import { LAYER } from "../lib/layers";
import { projectKey } from "../lib/paths";
import { clearProjectLogo, pickAndSetProjectLogo } from "../lib/projectLogos";
import { PROJECT_MASCOTS, projectMascot } from "../lib/projectMascots";
import { TAB_GROUP_COLORS } from "../lib/tabGroups";
import { ColorPickerPopover } from "./ColorPickerPopover";
import { Popover } from "./Popover";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { ProjectMascot } from "./ProjectMascot";
import { MOD } from "../lib/platform";

export type TabGroupMenuAction =
  | "new-tab"
  | "new-window"
  | "close-group"
  | "ungroup"
  | "delete-group";

export type TabGroupMenuExtraItem = {
  id: string;
  label: string;
  icon: IconComponent;
  danger?: boolean;
  sepBefore?: boolean;
  disabled?: boolean;
  description?: string;
  shortcut?: string;
  submenu?: { kind: "item"; id: string; label: string; disabled?: boolean }[];
};

type Props = {
  x: number;
  y: number;
  groupId: string;
  label: string;
  colorIndex: number | null;
  customColor: string | null;
  currentColor: string;
  logoPath: string | null;
  logoProject?: string | null;
  /** Explicit mascot pick; null means the one hashed from `mascotProject`. */
  mascotName: string | null;
  /** Key the fallback mascot is hashed from — same one the icon uses. */
  mascotProject: string;
  onRename: (groupId: string, label: string) => void;
  onColorChange: (groupId: string, colorIndex: number | null) => void;
  onCustomColorChange: (groupId: string, color: string) => void;
  onMascotChange: (groupId: string, name: string | null) => void;
  onLogoChange: () => void;
  onPick: (action: TabGroupMenuAction) => void;
  onClose: () => void;
  /** When false, only name / logo / color controls are shown. */
  showActions?: boolean;
  extraItems?: TabGroupMenuExtraItem[];
  footer?: ReactNode;
  onExtraPick?: (id: string) => void;
};

const MENU_WIDTH = 260;

type MenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  icon: IconComponent;
};

function items(t: (key: string) => string): MenuItem[] {
  return [
    {
      id: "new-tab",
      label: t("harness.chrome.newTabInGroup"),
      shortcut: `${MOD}T`,
      icon: SquarePlus,
    },
    {
      id: "new-window",
      label: t("harness.chrome.moveGroupToNewWindow"),
      icon: AppWindow,
    },
    {
      id: "close-group",
      label: t("harness.chrome.closeGroup"),
      shortcut: `${MOD}W`,
      icon: X,
    },
    {
      id: "ungroup",
      label: t("harness.chrome.ungroup"),
      icon: Ungroup,
    },
    {
      id: "delete-group",
      label: t("harness.chrome.deleteGroup"),
      danger: true,
      icon: Trash2,
    },
  ];
}

export function TabGroupMenu({
  x,
  y,
  groupId,
  label,
  colorIndex,
  customColor,
  currentColor,
  logoPath,
  logoProject,
  mascotName,
  mascotProject,
  onRename,
  onColorChange,
  onCustomColorChange,
  onMascotChange,
  onLogoChange,
  onPick,
  onClose,
  showActions = true,
  extraItems,
  footer,
  onExtraPick,
}: Props) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(label);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [submenu, setSubmenu] = useState<{
    item: TabGroupMenuExtraItem;
    anchor: HTMLButtonElement;
  } | null>(null);
  const submenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuItems = items(t);

  const cancelSubmenuClose = () => {
    if (submenuCloseTimer.current != null) clearTimeout(submenuCloseTimer.current);
    submenuCloseTimer.current = null;
  };

  const scheduleSubmenuClose = () => {
    cancelSubmenuClose();
    submenuCloseTimer.current = setTimeout(() => setSubmenu(null), 180);
  };

  const closeSubmenu = () => {
    cancelSubmenuClose();
    setSubmenu(null);
  };

  const pickExtra = (id: string) => {
    onExtraPick?.(id);
    onClose();
  };

  useEffect(() => cancelSubmenuClose, []);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const shownMascot = projectMascot(mascotProject, mascotName).name;

  const commitName = () => {
    onRename(groupId, name.trim());
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && e.target === input.current) {
      e.preventDefault();
      commitName();
      onClose();
    }
  };

  return (
    <>
      <Popover
        anchor={{ x, y }}
        side="right"
        gap={0}
        width={MENU_WIDTH}
        constrainHeight={false}
        onDismiss={onClose}
        role="menu"
        tabIndex={-1}
        aria-label={t("harness.chrome.tabGroupActions")}
        onKeyDown={onMenuKey}
        onContextMenu={(e) => e.preventDefault()}
        className="p-2"
      >
        <input
          ref={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          aria-label={t("harness.chrome.groupName")}
          className="mb-2 w-full rounded-lg border border-content/10 bg-content/5 px-2.5 py-1.5 text-[13px] text-content outline-none ring-accent/40 focus:ring-1"
        />

        {logoProject ? (
          <div className="mb-2 flex items-center gap-2 px-0.5">
            <button
              type="button"
              title={
                logoPath
                  ? t("harness.chrome.changeProjectLogo")
                  : t("harness.chrome.addProjectLogo")
              }
              aria-label={
                logoPath
                  ? t("harness.chrome.changeProjectLogo")
                  : t("harness.chrome.addProjectLogo")
              }
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                void (async () => {
                  try {
                    const path = await pickAndSetProjectLogo(logoProject);
                    if (path) onLogoChange();
                  } catch (error) {
                    console.error("Failed to save project logo:", error);
                  } finally {
                    onClose();
                  }
                })();
              }}
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-content/10 bg-content/5 hover:bg-content/10"
            >
              <ProjectLogoIcon
                path={logoPath}
                className="size-5"
                imageClassName="size-5"
                fallback={ImagePlus}
                fallbackStrokeWidth={1.75}
              />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-content/50">
                {t("harness.chrome.projectLogo")}
              </p>
              <p className="truncate text-[12px] text-content/70">
                {logoPath
                  ? t("harness.chrome.projectLogoShown")
                  : t("harness.chrome.projectLogoOptional")}
              </p>
            </div>
            {logoPath ? (
              <button
                type="button"
                title={t("harness.chrome.removeProjectLogo")}
                aria-label={t("harness.chrome.removeProjectLogo")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  void clearProjectLogo(projectKey(logoProject)).then(onLogoChange);
                }}
                className="grid size-7 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mb-2 flex items-center justify-between gap-1 px-0.5">
          {TAB_GROUP_COLORS.map((color, index) => {
            const selected =
              customColor == null &&
              (colorIndex === index || (colorIndex == null && index === 0));
            return (
              <button
                key={color}
                type="button"
                title={t("harness.chrome.colorIndex", { index: index + 1 })}
                aria-label={t("harness.chrome.colorIndex", { index: index + 1 })}
                aria-pressed={selected}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setCustomPickerOpen(false);
                  onColorChange(groupId, index === 0 ? null : index);
                }}
                className="grid size-5 place-items-center rounded-full"
              >
                <span
                  className={`size-3.5 rounded-full ${
                    selected ? "ring-2 ring-content/80 ring-offset-1 ring-offset-transparent" : ""
                  }`}
                  style={{ background: color }}
                />
              </button>
            );
          })}
          <button
            type="button"
            title={t("harness.chrome.customColor")}
            aria-label={t("harness.chrome.customColor")}
            aria-expanded={customPickerOpen}
            aria-pressed={customColor != null}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setCustomPickerOpen((open) => !open)}
            className="grid size-5 place-items-center rounded-full"
          >
            <span
              className={`grid size-3.5 place-items-center overflow-hidden rounded-full ${
                customColor != null || customPickerOpen
                  ? "ring-2 ring-content/80 ring-offset-1 ring-offset-transparent"
                  : ""
              }`}
              style={
                customColor
                  ? { background: customColor }
                  : {
                      background:
                        "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                    }
              }
            >
              {!customColor ? (
                <Pipette className="size-2 text-white drop-shadow-sm" strokeWidth={2.25} />
              ) : null}
            </span>
          </button>
        </div>

        {customPickerOpen ? (
          <ColorPickerPopover
            value={customColor ?? normalizeHex(currentColor)}
            onChange={(color) => onCustomColorChange(groupId, color)}
          />
        ) : null}

        <div className="mb-2 px-0.5">
          <p className="mb-1 text-[11px] text-content/50">
            {t("harness.chrome.mascot")}
          </p>
          <div className="flex items-center justify-between gap-1">
            {PROJECT_MASCOTS.map((mascot) => (
              <MascotSwatch
                key={mascot.name}
                title={mascot.name}
                selected={shownMascot === mascot.name}
                onPick={() => onMascotChange(groupId, mascot.name)}
              >
                <ProjectMascot
                  project={groupId}
                  name={mascot.name}
                  className="size-3 text-content/75"
                />
              </MascotSwatch>
            ))}
          </div>
        </div>

        {showActions ? (
          <>
            <div className="my-1 h-px bg-content/10" />

            {menuItems.slice(0, 2).map((item) => (
              <MenuRow
                key={item.id}
                item={item}
                onHover={() => setSubmenu(null)}
                onPick={() => onPick(item.id as TabGroupMenuAction)}
              />
            ))}

            <div className="my-1 h-px bg-content/10" />

            {menuItems.slice(2, 4).map((item) => (
              <MenuRow
                key={item.id}
                item={item}
                onHover={() => setSubmenu(null)}
                onPick={() => onPick(item.id as TabGroupMenuAction)}
              />
            ))}

            <div className="my-1 h-px bg-content/10" />

            {menuItems.slice(4).map((item) => (
              <MenuRow
                key={item.id}
                item={item}
                onHover={() => setSubmenu(null)}
                onPick={() => onPick(item.id as TabGroupMenuAction)}
              />
            ))}
          </>
        ) : null}

        {extraItems && extraItems.length > 0 ? (
          <>
            <div className="my-1 h-px bg-content/10" />
            {extraItems.map((item) => (
              <Fragment key={item.id}>
                {item.sepBefore ? (
                  <div role="separator" className="my-1 h-px bg-content/10" />
                ) : null}
                <MenuRow
                  item={item}
                  expanded={submenu?.item.id === item.id}
                  onHover={(anchor) =>
                    setSubmenu(
                      item.submenu && !item.disabled ? { item, anchor } : null,
                    )
                  }
                  onPick={(anchor) => {
                    if (item.submenu) setSubmenu({ item, anchor });
                    else pickExtra(item.id);
                  }}
                />
              </Fragment>
            ))}
          </>
        ) : null}
        {footer}
      </Popover>
      {submenu && submenu.item.submenu ? (
        <Popover
          anchor={submenu.anchor}
          side="right"
          gap={4}
          width={MENU_WIDTH}
          layer={LAYER.submenu}
          onDismiss={closeSubmenu}
          role="menu"
          tabIndex={-1}
          aria-label={submenu.item.label}
          onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={cancelSubmenuClose}
          onMouseLeave={scheduleSubmenuClose}
          className="p-1"
        >
          {submenu.item.submenu.map((subItem) => (
            <button
              key={subItem.id}
              type="button"
              role="menuitem"
              disabled={subItem.disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickExtra(subItem.id)}
              className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] leading-none ${
                subItem.disabled
                  ? "text-content/30"
                  : "text-content hover:bg-content/5"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{subItem.label}</span>
            </button>
          ))}
        </Popover>
      ) : null}
    </>
  );
}

function MascotSwatch({
  title,
  selected,
  onPick,
  children,
}: {
  title: string;
  selected: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      title={title}
      aria-label={t("harness.chrome.mascotNamed", { name: title })}
      aria-pressed={selected}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={`grid size-5 shrink-0 place-items-center rounded-md ${
        selected ? "bg-content/15 ring-1 ring-content/50" : "hover:bg-content/8"
      }`}
    >
      {children}
    </button>
  );
}

function MenuRow({
  item,
  onPick,
  onHover,
  expanded,
}: {
  item: (MenuItem | TabGroupMenuExtraItem) & {
    disabled?: boolean;
    submenu?: { kind: "item"; id: string; label: string; disabled?: boolean }[];
    description?: string;
  };
  onPick: (anchor: HTMLButtonElement) => void;
  onHover?: (anchor: HTMLButtonElement) => void;
  expanded?: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      aria-haspopup={item.submenu ? "menu" : undefined}
      aria-expanded={item.submenu ? expanded : undefined}
      aria-label={item.description ? item.label : undefined}
      aria-description={item.description}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={(e) => onHover?.(e.currentTarget)}
      onClick={(e) => onPick(e.currentTarget)}
      onKeyDown={(e) => {
        if (item.submenu && e.key === "ArrowRight") {
          e.preventDefault();
          onPick(e.currentTarget);
        }
      }}
      className={`flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] leading-none ${
        item.disabled
          ? "text-content/30"
          : item.danger
            ? "text-red-300/90 hover:bg-red-500/15"
            : "text-content hover:bg-content/5"
      }`}
    >
      <Icon className="size-3.5 shrink-0 text-content/55" strokeWidth={1.75} />
      <span className={`min-w-0 flex-1 ${item.description ? "py-2" : "truncate"}`}>
        {item.label}
        {item.description ? (
          <span className="mt-1 block text-[11px] leading-snug text-content/60">
            {item.description}
          </span>
        ) : null}
      </span>
      {item.submenu ? (
        <ChevronRight className="size-3.5 shrink-0 text-content/50" strokeWidth={1.75} />
      ) : null}
      {item.shortcut ? (
        <span className="shrink-0 text-[11px] text-content/40">
          {item.shortcut}
        </span>
      ) : null}
    </button>
  );
}
