import { GripVertical, Terminal, X } from "./icons";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useTranslation } from "@/modules/i18n";
import { copyText } from "../lib/clipboard";
import { basename, revealPath } from "../lib/fs";
import { displayPath } from "../lib/paths";
import { IS_MAC, IS_WIN } from "../lib/platform";
import {
  isChangesTab,
  isFilesystemTab,
  isPlanTab,
  isReleaseNotesTab,
  isReviewTab,
  isSessionChangesTab,
  isTerminalTab,
  type FilePaneTab,
} from "../lib/layout";
import { releaseNotesTitle } from "../lib/releaseNotes";
import { terminalTabLabel } from "../lib/terminalTab";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useSortable } from "../hooks/useSortable";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { FileTypeIcon } from "./FileTypeIcon";

type Props = {
  files: FilePaneTab[];
  activeFileId: string;
  dirtyFileIds: Set<string>;
  fileErrorCounts: Map<string, number>;
  onSelectFile: (fileId: string) => void;
  onCloseFile: (fileId: string) => void;
  onCloseOtherFiles?: (fileId: string) => void;
  onReorder: (ids: string[]) => void;
  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  label?: string;
  trailing?: ReactNode;
};

export type SurfaceTabPresentation = {
  name: string;
  label: string;
  iconName: string;
  tooltip: string;
};

export function surfaceTabPresentation(
  file: FilePaneTab,
  t: (key: string, values?: Record<string, string | number>) => string,
): SurfaceTabPresentation {
  if (isReleaseNotesTab(file)) {
    const title = releaseNotesTitle(file.releaseNotes.version);
    return {
      name: title,
      label: title,
      iconName: "CHANGELOG.md",
      tooltip: title,
    };
  }

  if (isChangesTab(file)) {
    return {
      name: t("harness.chrome.changes"),
      label: t("harness.chrome.changes"),
      iconName: "CHANGES",
      tooltip: t("harness.chrome.workingTreeChanges"),
    };
  }

  if (isSessionChangesTab(file)) {
    return {
      name: t("harness.chrome.sessionChanges"),
      label: t("harness.chrome.sessionChanges"),
      iconName: "CHANGES",
      tooltip: t("harness.chrome.sessionChangesTooltip"),
    };
  }

  const review = isReviewTab(file);
  const terminal = isTerminalTab(file);
  const name = isPlanTab(file)
    ? file.plan.title.trim() || t("harness.chrome.plan")
    : terminal
      ? terminalTabLabel(file)
      : basename(file.path);
  return {
    name,
    label: review ? t("harness.chrome.workingTreeNamed", { name }) : name,
    iconName: isPlanTab(file) ? "plan.md" : name,
    tooltip: isPlanTab(file)
      ? name
      : terminal
        ? `${name} — ${file.cwd}`
        : review
          ? t("harness.chrome.workingTreeNamed", { name: file.path })
          : file.path,
  };
}

/** Mirrors the VS Code tab tooltip: the path, then what is wrong with it. */
export function appendProblems(
  t: (key: string, values?: Record<string, string | number>) => string,
  title: string,
  errors: number,
): string {
  if (!errors) return title;
  return t("harness.chrome.tabProblems", { title, count: errors });
}

type SurfaceTabMenu = {
  x: number;
  y: number;
  fileId: string;
};

export function surfaceTabMenuItems(
  file: FilePaneTab,
  t: (key: string) => string,
  canCloseOthers = true,
): ExplorerMenuItem[] {
  const close: ExplorerMenuItem = {
    kind: "item",
    id: "close",
    label: t("common.close"),
  };
  const closeOthers: ExplorerMenuItem = {
    kind: "item",
    id: "close-others",
    label: t("harness.chrome.closeOthers"),
    disabled: !canCloseOthers,
  };
  if (!isFilesystemTab(file) || isChangesTab(file)) {
    return [close, closeOthers];
  }

  const revealLabel = IS_MAC
    ? t("harness.chrome.revealInFinder")
    : IS_WIN
      ? t("harness.chrome.revealInFileExplorer")
      : t("harness.chrome.openContainingFolder");

  return [
    {
      kind: "item",
      id: "open-default",
      label: t("harness.chrome.openInDefaultApp"),
    },
    { kind: "item", id: "reveal", label: revealLabel },
    { kind: "sep" },
    { kind: "item", id: "copy-path", label: t("harness.chrome.copyPath") },
    {
      kind: "item",
      id: "copy-relative-path",
      label: t("harness.chrome.copyRelativePath"),
    },
    { kind: "item", id: "copy-name", label: t("harness.chrome.copyFileName") },
    { kind: "sep" },
    close,
    closeOthers,
  ];
}

export function SurfaceTabs({
  files,
  activeFileId,
  dirtyFileIds,
  fileErrorCounts,
  onSelectFile,
  onCloseFile,
  onCloseOtherFiles,
  onReorder,
  onPaneDragStart,
  label,
  trailing,
}: Props) {
  const { t } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<SurfaceTabMenu | null>(null);
  const fileIds = files.map((file) => file.id);
  const sortable = useSortable(fileIds, onReorder);
  const canDrag = files.length > 1;
  const menuFile = menu
    ? files.find((file) => file.id === menu.fileId)
    : undefined;

  const onMenuPick = (id: string) => {
    if (!menuFile) return;
    setMenu(null);
    if (id === "close") {
      onCloseFile(menuFile.id);
      return;
    }
    if (id === "close-others") {
      onCloseOtherFiles?.(menuFile.id);
      return;
    }
    if (!isFilesystemTab(menuFile) || isChangesTab(menuFile)) return;

    let action: Promise<void>;
    switch (id) {
      case "open-default":
        action = openPath(menuFile.path);
        break;
      case "reveal":
        action = revealPath(menuFile.path);
        break;
      case "copy-path":
        action = copyText(menuFile.path);
        break;
      case "copy-relative-path":
        action = copyText(displayPath(menuFile.path, menuFile.cwd));
        break;
      case "copy-name":
        action = copyText(basename(menuFile.path));
        break;
      default:
        return;
    }
    void action.catch((error) => {
      console.error(`Failed to run file-tab action ${id}:`, error);
    });
  };

  useLayoutEffect(() => {
    if (sortable.draggingId) return;
    activeTabRef.current?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
    });
  }, [activeFileId, sortable.draggingId]);

  return (
    <div className="flex h-9 min-w-0 shrink-0 border-b border-stroke">
      <div
        ref={lockOverscroll}
        role="tablist"
        aria-label={label}
        className="scrollbar-none flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-none pl-1.5 pr-2.5"
      >
      {onPaneDragStart ? (
        <div
          role="button"
          title={t("harness.chrome.dragReorderPane")}
          aria-label={t("harness.chrome.dragReorderPane")}
          tabIndex={-1}
          className="grid h-7.5 w-5 shrink-0 cursor-grab place-items-center rounded-md text-content/35 hover:bg-content/5 hover:text-content/70 active:cursor-grabbing touch-none"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            onPaneDragStart(event);
          }}
        >
          <GripVertical className="size-3.5" strokeWidth={1.75} />
        </div>
      ) : null}
      {files.map((file, index) => {
        const active = file.id === activeFileId;
        const dirty = dirtyFileIds.has(file.id);
        const errors = fileErrorCounts.get(file.id) ?? 0;
        const review = isReviewTab(file);
        const terminal = isTerminalTab(file);
        const { label, iconName, tooltip } = surfaceTabPresentation(file, t);
        const showStart =
          sortable.draggingId &&
          sortable.toIndex === index &&
          sortable.fromIndex !== null &&
          sortable.toIndex < sortable.fromIndex;
        const showEnd =
          sortable.draggingId &&
          sortable.toIndex === index &&
          sortable.fromIndex !== null &&
          sortable.toIndex > sortable.fromIndex;
        return (
          <div
            key={file.id}
            ref={(el) => {
              sortable.setItemRef(file.id, el);
              if (el && file.id === activeFileId) activeTabRef.current = el;
            }}
            className={`reorder-item tab-motion group relative flex h-full w-56 min-w-28 shrink touch-none items-center ${
              canDrag ? "cursor-grab active:cursor-grabbing" : ""
            }`}
            onMouseDownCapture={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              event.stopPropagation();
              onCloseFile(file.id);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              if (
                (event.target as HTMLElement | null)?.closest("[data-no-drag]")
              ) {
                return;
              }
              onSelectFile(file.id);
              sortable.onItemPointerDown(file.id, event);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelectFile(file.id);
              setMenu({
                x: event.clientX,
                y: event.clientY,
                fileId: file.id,
              });
            }}
          >
            {showStart ? (
              <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-0.5 bg-accent" />
            ) : null}
            {showEnd ? (
              <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-0.5 bg-accent" />
            ) : null}
            <button
              type="button"
              role="tab"
              aria-selected={active}
              title={appendProblems(t, tooltip, errors)}
              onClick={() => {
                if (sortable.consumeClick()) return;
                onSelectFile(file.id);
              }}
              className={`relative flex h-7.5 min-w-0 flex-1 items-center gap-1.5 self-center rounded-md px-2 pr-7 text-left text-[13px] ${
                canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-default"
              } ${
                active
                  ? "bg-selection text-content"
                  : "text-content/50 hover:bg-content/5 hover:text-content"
              }`}
            >
              {terminal ? (
                <Terminal className="size-3.5 shrink-0" strokeWidth={1.75} />
              ) : (
                <FileTypeIcon name={iconName} isDir={false} size={14} />
              )}
              <span
                className={`min-w-0 flex-1 truncate ${review ? "italic" : ""} ${
                  errors
                    ? active
                    ? "text-red-400"
                    : "text-red-400/75 group-hover:text-red-400"
                    : ""
                }`}
              >
                {label}
              </span>
              {dirty ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-content/70"
                  title={t("harness.chrome.unsavedChanges")}
                  aria-label={t("harness.chrome.unsavedChanges")}
                />
              ) : null}
            </button>
            <button
              type="button"
              title={t("harness.chrome.closeNamed", { name: label })}
              aria-label={t("harness.chrome.closeNamed", { name: label })}
              data-no-drag
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onCloseFile(file.id);
              }}
              className={`absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-content/50 hover:bg-content/10 hover:text-content ${
                active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <X className="size-3" strokeWidth={1.75} />
            </button>
          </div>
        );
      })}
      {onPaneDragStart ? (
        <div
          className="min-w-4 flex-1 cursor-grab active:cursor-grabbing"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            onPaneDragStart(event);
          }}
        />
      ) : null}
      </div>
      {trailing}
      {menu && menuFile ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={surfaceTabMenuItems(menuFile, t, files.length > 1)}
          ariaLabel={t("harness.chrome.fileTabActions")}
          onPick={onMenuPick}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
