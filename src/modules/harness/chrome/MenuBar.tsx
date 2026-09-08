import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { ALT, MOD, SHIFT } from "../lib/platform";
import { toggleTranscriptZen } from "../lib/appearance";
import { runUpdateFlow } from "../lib/updater";
import { useTranslation } from "@/modules/i18n";

type MenuKey = "file" | "view" | "terminal";

type Props = {
  onNew: () => void;
  onNewTerminal?: () => void;
  onToggleTerminal?: () => void;
  onGoToFile?: () => void;
  onToggleSidebar: () => void;
  onShowSourceControl?: () => void;
  onCloseCurrentTab?: () => void;
  onPickProject?: () => void;
  onFindInProject?: () => void;
  onSearch?: () => void;
  onOpenInbox?: () => void;
  onOpenNotes?: () => void;
};

export function MenuBar({
  onNew,
  onNewTerminal,
  onToggleTerminal,
  onGoToFile,
  onToggleSidebar,
  onShowSourceControl,
  onCloseCurrentTab,
  onPickProject,
  onFindInProject,
  onSearch,
  onOpenInbox,
  onOpenNotes,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Toggle with standalone Alt key tap
  useEffect(() => {
    let altPressedAlone = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altPressedAlone = true;
      } else if (altPressedAlone) {
        altPressedAlone = false;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" && altPressedAlone) {
        setOpen((prev) => {
          if (prev) {
            setActiveMenu(null);
            setMenuAnchor(null);
            return false;
          }
          return true;
        });
        altPressedAlone = false;
      }
    };

    const onBlur = () => {
      altPressedAlone = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const openDropdown = useCallback((key: MenuKey, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setActiveMenu(key);
    setMenuAnchor({ x: rect.left, y: rect.bottom + 2 });
  }, []);

  const closeMenu = useCallback(() => {
    setActiveMenu(null);
    setMenuAnchor(null);
  }, []);

  const handlePick = useCallback(
    (id: string) => {
      closeMenu();
      setOpen(false);

      switch (id) {
        case "new_tab":
          onNew();
          break;
        case "new_terminal":
          onNewTerminal?.();
          break;
        case "toggle_terminal":
          onToggleTerminal?.();
          break;
        case "new_window":
          void invoke("open_new_window").catch(() => {});
          break;
        case "open_project":
          onPickProject?.();
          break;
        case "open_search":
          onSearch?.();
          break;
        case "open_inbox":
          onOpenInbox?.();
          break;
        case "open_notes":
          onOpenNotes?.();
          break;
        case "go_to_file":
          onGoToFile?.();
          break;
        case "find_in_project":
          onFindInProject?.();
          break;
        case "close_tab":
          onCloseCurrentTab?.();
          break;
        case "toggle_sidebar":
          onToggleSidebar();
          break;
        case "toggle_zen":
          toggleTranscriptZen();
          break;
        case "open_model_picker":
          window.dispatchEvent(new Event("open_model_picker"));
          break;
        case "toggle_diff":
          onShowSourceControl?.();
          break;
        case "check_for_updates":
          void runUpdateFlow(true);
          break;
      }
    },
    [
      closeMenu,
      onCloseCurrentTab,
      onFindInProject,
      onGoToFile,
      onNew,
      onNewTerminal,
      onToggleTerminal,
      onPickProject,
      onSearch,
      onOpenInbox,
      onOpenNotes,
      onShowSourceControl,
      onToggleSidebar,
    ],
  );

  const getMenuItems = (key: MenuKey): ExplorerMenuItem[] => {
    switch (key) {
      case "file":
        return [
          { kind: "item", id: "new_tab", label: t("harness.menu.newTab"), shortcut: `${MOD}T` },
          { kind: "item", id: "new_terminal", label: t("harness.menu.newTerminal"), shortcut: `${MOD}\`` },
          { kind: "item", id: "new_window", label: t("harness.menu.newWindow"), shortcut: `${MOD}${SHIFT}N` },
          { kind: "sep" },
          { kind: "item", id: "open_project", label: t("harness.menu.openProject"), shortcut: `${MOD}O` },
          { kind: "item", id: "open_search", label: t("harness.menu.search"), shortcut: `${MOD}K` },
          { kind: "item", id: "go_to_file", label: t("harness.menu.goToFile"), shortcut: `${MOD}P` },
          { kind: "item", id: "find_in_project", label: t("harness.menu.findInFiles"), shortcut: `${MOD}${SHIFT}F` },
          { kind: "sep" },
          { kind: "item", id: "close_tab", label: t("harness.menu.closePane"), shortcut: `${MOD}W` },
          { kind: "sep" },
          { kind: "item", id: "check_for_updates", label: t("harness.menu.checkForUpdates") },
        ];
      case "view":
        return [
          { kind: "item", id: "toggle_sidebar", label: t("harness.menu.toggleSidebar"), shortcut: `${MOD}B` },
          { kind: "item", id: "toggle_zen", label: t("harness.menu.toggleZen"), shortcut: `${MOD}${ALT}Z` },
          { kind: "item", id: "open_inbox", label: t("harness.menu.inbox") },
          ...(onOpenNotes
            ? [{ kind: "item" as const, id: "open_notes", label: t("harness.menu.notes") }]
            : []),
          { kind: "item", id: "toggle_terminal", label: t("harness.menu.toggleTerminal"), shortcut: `${MOD}J` },
          { kind: "item", id: "open_model_picker", label: t("harness.menu.switchModel"), shortcut: `${MOD}.` },
          { kind: "item", id: "toggle_diff", label: t("harness.menu.toggleChanges") },
        ];
      case "terminal":
        return [
          { kind: "item", id: "new_terminal", label: t("harness.menu.newTerminal"), shortcut: `${MOD}\`` },
          { kind: "item", id: "toggle_terminal", label: t("harness.menu.toggleTerminal"), shortcut: `${MOD}J` },
        ];
    }
  };

  if (!open && !activeMenu) {
    return null;
  }

  const MENUS: { key: MenuKey; label: string }[] = [
    { key: "file", label: t("harness.menu.file") },
    { key: "view", label: t("harness.menu.view") },
    { key: "terminal", label: t("harness.menu.terminal") },
  ];

  return (
    <div
      ref={barRef}
      className="flex h-7 shrink-0 items-center gap-0.5 border-b border-content/10 bg-content/5 px-2 text-[12px]"
      data-tauri-drag-region="false"
    >
      {MENUS.map(({ key, label }) => {
        const isActive = activeMenu === key;
        return (
          <button
            key={key}
            type="button"
            data-tauri-drag-region="false"
            onClick={(e) => {
              if (isActive) {
                closeMenu();
              } else {
                openDropdown(key, e.currentTarget);
              }
            }}
            onMouseEnter={(e) => {
              if (activeMenu && activeMenu !== key) {
                openDropdown(key, e.currentTarget);
              }
            }}
            className={`rounded px-2 py-0.5 transition-colors ${
              isActive
                ? "bg-content/15 text-content"
                : "text-content/70 hover:bg-content/10 hover:text-content"
            }`}
          >
            {label}
          </button>
        );
      })}

      {activeMenu && menuAnchor ? (
        <ExplorerMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          items={getMenuItems(activeMenu)}
          ariaLabel={`${activeMenu} menu`}
          onPick={handlePick}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}
