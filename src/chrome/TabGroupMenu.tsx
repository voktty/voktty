import {
  AppWindow,
  ImagePlus,
  Pipette,
  SquarePlus,
  Trash2,
  Ungroup,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { normalizeHex } from "../lib/colorUtils";
import { clearProjectLogo, pickAndSetProjectLogo } from "../lib/projectLogos";
import { PROJECT_MASCOTS, projectMascot } from "../lib/projectMascots";
import { TAB_GROUP_COLORS } from "../lib/tabGroups";
import { ColorPickerPopover } from "./ColorPickerPopover";
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
  icon: typeof SquarePlus;
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
  onExtraPick?: (id: string) => void;
};

const MENU_WIDTH = 260;

type MenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  icon: typeof SquarePlus;
};

const ITEMS: MenuItem[] = [
  {
    id: "new-tab",
    label: "New tab in group",
    shortcut: `${MOD}T`,
    icon: SquarePlus,
  },
  {
    id: "new-window",
    label: "Move group to new window",
    icon: AppWindow,
  },
  {
    id: "close-group",
    label: "Close group",
    shortcut: `${MOD}W`,
    icon: X,
  },
  {
    id: "ungroup",
    label: "Ungroup",
    icon: Ungroup,
  },
  {
    id: "delete-group",
    label: "Delete group",
    danger: true,
    icon: Trash2,
  },
];

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
  onExtraPick,
}: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [name, setName] = useState(label);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad;
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad;
    }
    setPos({
      left: Math.max(pad, left),
      top: Math.max(pad, top),
    });
  }, [x, y, customPickerOpen]);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [pos]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
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

  return createPortal(
    <div
      ref={menu}
      role="menu"
      tabIndex={-1}
      aria-label="Tab group actions"
      onKeyDown={onMenuKey}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: MENU_WIDTH,
        zIndex: 80,
      }}
      className="rounded-xl border border-content/10 bg-content/10 p-2 shadow-xl backdrop-blur-xl outline-none"
    >
      <input
        ref={input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        aria-label="Group name"
        className="mb-2 w-full rounded-lg border border-content/10 bg-content/5 px-2.5 py-1.5 text-[13px] text-content outline-none ring-accent/40 focus:ring-1"
      />

      {logoProject ? (
        <div className="mb-2 flex items-center gap-2 px-0.5">
          <button
            type="button"
            title={logoPath ? "Change project logo" : "Add project logo"}
            aria-label={logoPath ? "Change project logo" : "Add project logo"}
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
            <p className="text-[11px] text-content/50">Project logo</p>
            <p className="truncate text-[12px] text-content/70">
              {logoPath ? "Shown in tabs and composer" : "Optional — replaces folder icon"}
            </p>
          </div>
          {logoPath ? (
            <button
              type="button"
              title="Remove project logo"
              aria-label="Remove project logo"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                void clearProjectLogo(logoProject).then(onLogoChange);
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
              title={`Color ${index + 1}`}
              aria-label={`Color ${index + 1}`}
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
          title="Custom color"
          aria-label="Custom color"
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
        <p className="mb-1 text-[11px] text-content/50">Mascot</p>
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

          {ITEMS.slice(0, 2).map((item) => (
            <MenuRow key={item.id} item={item} onPick={() => onPick(item.id as TabGroupMenuAction)} />
          ))}

          <div className="my-1 h-px bg-content/10" />

          {ITEMS.slice(2, 4).map((item) => (
            <MenuRow key={item.id} item={item} onPick={() => onPick(item.id as TabGroupMenuAction)} />
          ))}

          <div className="my-1 h-px bg-content/10" />

          {ITEMS.slice(4).map((item) => (
            <MenuRow key={item.id} item={item} onPick={() => onPick(item.id as TabGroupMenuAction)} />
          ))}
        </>
      ) : null}

      {extraItems && extraItems.length > 0 ? (
        <>
          <div className="my-1 h-px bg-content/10" />
          {extraItems.map((item) => (
            <MenuRow
              key={item.id}
              item={item}
              onPick={() => {
                onExtraPick?.(item.id);
                onClose();
              }}
            />
          ))}
        </>
      ) : null}
    </div>,
    document.body,
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
  return (
    <button
      type="button"
      title={title}
      aria-label={`Mascot ${title}`}
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
}: {
  item: MenuItem;
  onPick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      role="menuitem"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] leading-none ${
        item.danger
          ? "text-red-300/90 hover:bg-red-500/15"
          : "text-content hover:bg-content/5"
      }`}
    >
      <Icon className="size-3.5 shrink-0 text-content/55" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut ? (
        <span className="shrink-0 text-[11px] text-content/40">
          {item.shortcut}
        </span>
      ) : null}
    </button>
  );
}
