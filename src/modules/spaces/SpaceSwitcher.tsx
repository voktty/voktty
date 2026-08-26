import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useShortcutLabel } from "@/modules/shortcuts";
import type { ActiveStripItem, ViewSpace } from "@/modules/spaces";
import { useWorkspaceDrag } from "@/modules/spaces/lib/useWorkspaceDrag";
import {
  beginWorkspaceDrag,
  canExtractWorkspaceDrag,
  cancelWorkspaceDrag,
  finishWorkspaceDrag,
  getWorkspaceDragState,
  type WorkspaceDragSource,
  type WorkspaceDropTarget,
  workspaceDragSourceForTab,
} from "@/modules/spaces/lib/workspaceDrag";
import {
  labelFor,
  type Tab,
  TabIcon,
  useTabProcessStatus,
} from "@/modules/tabs";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  DashboardSquare01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InlineRename } from "./components/InlineRename";
import { accentFor, SPACE_COLORS } from "./lib/spaceColor";
import { calculateSpaceGeometry } from "./lib/spaceGeometry";
import {
  buildSpaceMenuModels,
  type SpaceMenuModel,
} from "./lib/spaceMenuModel";
import type { SpaceMeta } from "./lib/store";
import { useSpaces } from "./lib/useSpaces";
import { SpaceAvatar } from "./SpaceAvatar";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: Tab[];
  onNewSpace: () => void;
  onOpenSpace?: (id: string) => void;
  onDeleteSpace: (id: string) => void;
  viewSpaces?: readonly ViewSpace[];
  activeStripItem?: ActiveStripItem | null;
  onDeleteViewSpace?: (id: string) => void;
  onToggleViewSpace?: (id: string) => void;
  onExtractTabFromSpace?: (tabId: number) => void;
  onMoveTabToViewSpace?: (tabId: number, viewSpaceId: string) => void;
  onNewTabInSpace: (spaceId: string) => void;
  onJumpTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onMoveTabToSpace: (tabId: number, spaceId: string) => void;
  onReorderTab: (
    tabId: number,
    targetTabId: number,
    edge: "top" | "bottom",
  ) => void;
  onReorderSpaces: (orderedIds: string[]) => void;
  onWorkspaceDrop?: (
    source: WorkspaceDragSource,
    target: WorkspaceDropTarget,
  ) => void;
};

type Edge = "top" | "bottom";

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  kind: "space" | "tab";
  id: string | number;
  active: boolean;
};

type DropTarget =
  | { kind: "space"; spaceId: string; edge: Edge }
  | { kind: "tab"; tabId: number; edge: Edge }
  | { kind: "into-space"; spaceId: string };

function subtitleFor(tab: Tab): string | null {
  if (tab.kind === "terminal") {
    if (!tab.cwd) return null;
    const segs = tab.cwd.split(/[\\/]/).filter(Boolean);
    return segs.slice(-2).join("/") || tab.cwd;
  }
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const segs = tab.path.split(/[\\/]/).filter(Boolean);
    return segs.slice(-2, -1)[0] ?? null;
  }
  return null;
}

export function SpaceSwitcher({
  open,
  onOpenChange,
  tabs,
  onNewSpace,
  onOpenSpace,
  onDeleteSpace,
  viewSpaces = [],
  activeStripItem = null,
  onDeleteViewSpace,
  onToggleViewSpace,
  onExtractTabFromSpace,
  onMoveTabToViewSpace,
  onNewTabInSpace,
  onJumpTab,
  onCloseTab,
  onMoveTabToSpace,
  onReorderTab,
  onReorderSpaces,
  onWorkspaceDrop,
}: Props) {
  const { t } = useTranslation();
  const spaces = useSpaces((s) => s.spaces);
  const stripEntries = useSpaces((s) => s.stripEntries);
  const activeId = useSpaces((s) => s.activeId);
  const setActive = useSpaces((s) => s.setActive);
  const rename = useSpaces((s) => s.rename);
  const setColor = useSpaces((s) => s.setColor);
  const shortcut = useShortcutLabel("space.overview");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    activeId ? new Set([activeId]) : new Set(),
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const drag = useRef<DragState | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const [dragging, setDragging] = useState<{
    kind: "space" | "tab";
    id: string | number;
  } | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [overlay, setOverlay] = useState<{ x: number; y: number } | null>(null);
  const workspaceDrag = useWorkspaceDrag();
  const spaceViewLimit = usePreferencesStore((state) => state.spaceViewLimit);

  const current = spaces.find((s) => s.id === activeId);
  const activeViewSpaceId =
    activeStripItem?.kind === "space" ? activeStripItem.spaceId : null;

  const menuModels = useMemo(
    () => buildSpaceMenuModels(spaces, viewSpaces, tabs, stripEntries),
    [spaces, stripEntries, tabs, viewSpaces],
  );
  const modelById = useMemo(
    () => new Map(menuModels.map((model) => [model.space.id, model])),
    [menuModels],
  );
  const looseTabs = useMemo(
    () =>
      menuModels.flatMap((model) =>
        model.standaloneTabs.map((tab) => ({ space: model.space, tab })),
      ),
    [menuModels],
  );

  const draggedTab =
    dragging?.kind === "tab"
      ? (tabs.find((t) => t.id === dragging.id) ?? null)
      : null;
  const draggedSpace =
    dragging?.kind === "space"
      ? (spaces.find((s) => s.id === dragging.id) ?? null)
      : null;

  useEffect(() => {
    if (!open || !activeId) return;
    setExpanded((prev) =>
      prev.has(activeId) ? prev : new Set(prev).add(activeId),
    );
  }, [open, activeId]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const endDrag = (el: Element) => {
    const st = drag.current;
    if (st) el.releasePointerCapture?.(st.pointerId);
    drag.current = null;
    dropRef.current = null;
    setDragging(null);
    setDrop(null);
    setOverlay(null);
    document.body.style.userSelect = "";
  };

  useEffect(() => () => cancelWorkspaceDrag(), []);

  const onPointerDown = (
    e: React.PointerEvent,
    kind: "space" | "tab",
    id: string | number,
  ) => {
    if (e.button !== 0) return;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      kind,
      id,
      active: false,
    };
    if (kind === "tab") {
      const tab = tabs.find((candidate) => candidate.id === id);
      if (tab) {
        beginWorkspaceDrag(
          workspaceDragSourceForTab(tab.id, tab.tabKey, viewSpaces),
          { x: e.clientX, y: e.clientY },
        );
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = drag.current;
    if (!st) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!st.active) {
      if (Math.hypot(dx, dy) < 4) return;
      st.active = true;
      e.currentTarget.setPointerCapture?.(st.pointerId);
      setDragging({ kind: st.kind, id: st.id });
      document.body.style.userSelect = "none";
    }
    setOverlay({ x: e.clientX, y: e.clientY });

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const dropTarget = resolveDropTarget(el, st);
    dropRef.current = dropTarget;
    setDrop(dropTarget);
  };

  const resolveDropTarget = (
    el: Element | null,
    st: DragState,
  ): DropTarget | null => {
    const hit = el?.closest("[data-drop]");
    if (!hit) return null;
    const rect = hit.getBoundingClientRect();
    const edge: Edge =
      st.startY < rect.top + rect.height / 2 ? "top" : "bottom";
    const kind = hit.getAttribute("data-drop");
    if (st.kind === "space" && kind === "space") {
      const spaceId = hit.getAttribute("data-space-id");
      return spaceId && spaceId !== st.id
        ? { kind: "space", spaceId, edge }
        : null;
    }
    if (kind === "tab") {
      const tabId = Number(hit.getAttribute("data-tab-id"));
      return tabId !== st.id ? { kind: "tab", tabId, edge } : null;
    }
    if (kind === "space") {
      const spaceId = hit.getAttribute("data-space-id");
      return spaceId ? { kind: "into-space", spaceId } : null;
    }
    return null;
  };

  const commit = () => {
    const st = drag.current;
    const dp = dropRef.current;
    if (!st?.active || !dp) return;

    if (st.kind === "tab") {
      const tabId = typeof st.id === "number" ? st.id : Number(st.id);
      if (dp.kind === "into-space") {
        onMoveTabToSpace(tabId, dp.spaceId);
      } else if (dp.kind === "tab") {
        onReorderTab(tabId, dp.tabId, dp.edge);
      }
    } else if (st.kind === "space" && dp.kind === "space") {
      const srcId = String(st.id);
      const tgtId = dp.spaceId;
      if (srcId !== tgtId) {
        const order = spaces.map((s) => s.id);
        const fromIdx = order.indexOf(srcId);
        if (fromIdx !== -1) {
          order.splice(fromIdx, 1);
          let toIdx = order.indexOf(tgtId);
          if (toIdx !== -1) {
            if (dp.edge === "bottom") toIdx += 1;
            order.splice(toIdx, 0, srcId);
            onReorderSpaces(order);
          }
        }
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent, onActivate?: () => void) => {
    const st = drag.current;
    const workspaceState = getWorkspaceDragState();
    if (
      workspaceState.active &&
      workspaceState.source &&
      workspaceState.target &&
      onWorkspaceDrop
    ) {
      e.preventDefault();
      e.stopPropagation();
      const finished = finishWorkspaceDrag();
      if (finished.source && finished.target) {
        onWorkspaceDrop(finished.source, finished.target);
      }
      endDrag(e.currentTarget);
      return;
    }
    if (workspaceState.source) finishWorkspaceDrag();
    if (st?.active) commit();
    else if (st) onActivate?.();
    endDrag(e.currentTarget);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    cancelWorkspaceDrag();
    endDrag(e.currentTarget);
  };

  if (!current) return null;
  const pendingDeleteModel = pendingDeleteId
    ? modelById.get(pendingDeleteId)
    : undefined;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={
            shortcut ? `${t("spaces.title")} · ${shortcut}` : t("spaces.title")
          }
          aria-label={t("spaces.title")}
          className="flex size-6.5 shrink-0 items-center justify-center rounded-md text-muted-foreground/90 outline-none transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <HugeiconsIcon
            icon={DashboardSquare01Icon}
            size={14}
            strokeWidth={1.75}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[20rem] p-1.5">
        <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
          <span className="text-xs font-semibold text-foreground">
            {t("spaces.title")}
          </span>
          {shortcut && (
            <Kbd className="h-5 bg-muted/70 text-[10px]">{shortcut}</Kbd>
          )}
        </div>
        <div className="-mx-0.5 max-h-[60vh] overflow-y-auto px-0.5">
          {spaces.map((sp) => (
            <SpaceRow
              key={sp.id}
              space={sp}
              model={modelById.get(sp.id) ?? emptySpaceModel(sp)}
              isActive={
                sp.id === activeId || activeViewSpaceId === `view-${sp.id}`
              }
              canDelete={
                Boolean(modelById.get(sp.id)?.viewSpace) || spaces.length > 1
              }
              expanded={expanded.has(sp.id)}
              editing={editingId === sp.id}
              dragging={dragging}
              drop={drop}
              draggingTabFromOther={
                draggedTab !== null && draggedTab.spaceId !== sp.id
              }
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={handlePointerCancel}
              onToggle={() => toggleExpand(sp.id)}
              onSwitch={() => {
                onOpenSpace?.(sp.id);
                if (!onOpenSpace) setActive(sp.id);
                onOpenChange(false);
              }}
              onStartRename={() => setEditingId(sp.id)}
              onCommitRename={(name) => {
                const v = name.trim();
                if (v) rename(sp.id, v);
                setEditingId(null);
              }}
              onCancelRename={() => setEditingId(null)}
              onSetColor={(color) => setColor(sp.id, color)}
              onToggleViewSpace={onToggleViewSpace}
              onDelete={() => {
                if (onDeleteViewSpace && modelById.get(sp.id)?.viewSpace) {
                  setPendingDeleteId(sp.id);
                } else {
                  onDeleteSpace(sp.id);
                }
              }}
              onNewTab={() => onNewTabInSpace(sp.id)}
              canAddTab={
                !modelById.get(sp.id)?.viewSpace ||
                (modelById.get(sp.id)?.members.length ?? 0) < spaceViewLimit
              }
              maxMembers={spaceViewLimit}
              onJumpTab={onJumpTab}
              onCloseTab={onCloseTab}
              viewSpaces={viewSpaces}
              onExtractTabFromSpace={onExtractTabFromSpace}
              onMoveTabToViewSpace={onMoveTabToViewSpace}
            />
          ))}
          <div
            data-workspace-drop-kind="loose-strip"
            className="mt-1.5 border-t border-border/60 px-1.5 pt-2"
          >
            <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/65">
              {t("spaces.standaloneTabs")}
            </span>
            {looseTabs.length > 0 ? (
              <div className="mt-1 flex flex-col gap-px">
                {looseTabs.map(({ space, tab }) => (
                  <TabRow
                    key={`${space.id}:${tab.id}`}
                    tab={tab}
                    dragging={dragging}
                    drop={drop}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={handlePointerCancel}
                    onJump={() => onJumpTab(tab.id)}
                    onClose={() => onCloseTab(tab.id)}
                    member={false}
                    slotId={null}
                    focused={false}
                    viewSpaces={viewSpaces}
                    onExtract={() => undefined}
                    onMoveToSpace={(viewSpaceId) =>
                      onMoveTabToViewSpace?.(tab.id, viewSpaceId)
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="mt-1 rounded border border-dashed border-border/40 px-2 py-1 text-center text-[10.5px] text-muted-foreground/50">
                {t("spaces.dropToExtract")}
              </div>
            )}
          </div>
        </div>
        <div className="mt-1.5 border-t border-border/60 pt-1.5">
          <button
            type="button"
            onClick={onNewSpace}
            data-workspace-drop-kind="new-space"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.75} />
            <span className="flex-1">{t("spaces.newSpace")}</span>
          </button>
          {workspaceDrag.active && canExtractWorkspaceDrag(workspaceDrag.source) && (
            <div
              data-workspace-drop-kind="loose-strip"
              className="mt-1 rounded-md border border-dashed border-primary/50 px-2 py-1 text-[10px] text-primary/90"
            >
              {t("spaces.extractMember")}
            </div>
          )}
        </div>
      </PopoverContent>
      {overlay &&
        (draggedSpace || draggedTab) &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[60]"
            style={{ left: overlay.x + 12, top: overlay.y + 8 }}
          >
            {draggedSpace ? (
              <OverlayChip
                color={accentFor(draggedSpace)}
                label={draggedSpace.name}
              />
            ) : draggedTab ? (
              <OverlayChip tab={draggedTab} label={labelFor(draggedTab)} />
            ) : null}
          </div>,
          document.body,
        )}
      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("spaces.deleteSpaceTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("spaces.deleteSpaceDescription", {
                name: pendingDeleteModel?.space.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDeleteModel?.viewSpace && onDeleteViewSpace) {
                  onDeleteViewSpace(pendingDeleteModel.viewSpace.id);
                }
                setPendingDeleteId(null);
              }}
            >
              {t("spaces.deleteSpace")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Popover>
  );
}

function emptySpaceModel(space: SpaceMeta): SpaceMenuModel {
  return {
    space,
    viewSpace: null,
    tabs: [],
    members: [],
    standaloneTabs: [],
    focusedMemberKey: null,
    memberSlotByKey: new Map(),
    slotCount: 0,
    freeSlotCount: 0,
    presentation: "empty",
  };
}

type SpaceRowProps = {
  space: SpaceMeta;
  model: SpaceMenuModel;
  isActive: boolean;
  canDelete: boolean;
  expanded: boolean;
  editing: boolean;
  dragging: { kind: "space" | "tab"; id: string | number } | null;
  drop: DropTarget | null;
  draggingTabFromOther: boolean;
  onPointerDown: (
    e: React.PointerEvent,
    kind: "space" | "tab",
    id: string | number,
  ) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent, onActivate?: () => void) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onToggle: () => void;
  onSwitch: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onSetColor: (color: number | undefined) => void;
  onToggleViewSpace?: (id: string) => void;
  onDelete: () => void;
  onNewTab: () => void;
  canAddTab: boolean;
  maxMembers: number;
  onJumpTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  viewSpaces: readonly ViewSpace[];
  onExtractTabFromSpace?: (tabId: number) => void;
  onMoveTabToViewSpace?: (tabId: number, viewSpaceId: string) => void;
};

function SpaceRow({
  space,
  model,
  isActive,
  canDelete,
  expanded,
  editing,
  dragging,
  drop,
  draggingTabFromOther,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onToggle,
  onSwitch,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onSetColor,
  onToggleViewSpace,
  onDelete,
  onNewTab,
  canAddTab,
  maxMembers,
  onJumpTab,
  onCloseTab,
  viewSpaces,
  onExtractTabFromSpace,
  onMoveTabToViewSpace,
}: SpaceRowProps) {
  const { t } = useTranslation();
  const isDragging = dragging?.kind === "space" && dragging.id === space.id;
  const moveTarget = drop?.kind === "into-space" && drop.spaceId === space.id;
  const reorderEdge =
    drop?.kind === "space" && drop.spaceId === space.id ? drop.edge : null;

  return (
    <div className={cn("relative", isDragging && "opacity-50")}>
      {reorderEdge && <DropLine edge={reorderEdge} />}
      {/* biome-ignore lint/a11y/useSemanticElements: drag row hosts nested buttons, cannot be a <button> */}
      <div
        data-drop="space"
        data-space-id={space.id}
        data-workspace-drop-kind="space"
        data-workspace-view-space-id={`view-${space.id}`}
        role="button"
        tabIndex={editing ? -1 : 0}
        onPointerDown={
          editing ? undefined : (e) => onPointerDown(e, "space", space.id)
        }
        onPointerMove={onPointerMove}
        onPointerUp={editing ? undefined : (e) => onPointerUp(e, onSwitch)}
        onPointerCancel={onPointerCancel}
        onKeyDown={(e) => {
          if (editing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            onSwitch();
          }
        }}
        className={cn(
          "group relative flex cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
          moveTarget
            ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
            : isActive
              ? "bg-accent"
              : "hover:bg-accent/50",
        )}
      >
        <button
          type="button"
          data-no-drag
          aria-label={expanded ? t("spaces.collapse") : t("spaces.expand")}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground"
        >
          <HugeiconsIcon
            icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
            size={13}
            strokeWidth={2}
          />
        </button>
        <SpaceAvatar space={space} size="sm" active={isActive} />
        {editing ? (
          <InlineRename
            initial={space.name}
            ariaLabel={t("common.rename")}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
            className="ml-0.5"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {space.name}
          </span>
        )}
        {!editing && (
          <>
            <span className="flex min-w-0 flex-1 items-center gap-1 truncate px-1 text-[10px] text-muted-foreground/65 group-hover:hidden">
              <span>{t(`spaces.presentation.${model.presentation}`)}</span>
              <span className="tabular-nums">
                {model.members.length}/{maxMembers}
              </span>
              {model.freeSlotCount > 0 && (
                <span>
                  · {t("spaces.freeSlots", { count: model.freeSlotCount })}
                </span>
              )}
            </span>
            <div
              data-no-drag
              className="flex shrink-0 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto"
            >
              <RowAction
                icon={PencilEdit02Icon}
                label={t("spaces.renameSpace")}
                onClick={onStartRename}
              />
              <SpaceColorPicker space={space} onSetColor={onSetColor} />
              {model.viewSpace && onToggleViewSpace && (
                <RowAction
                  icon={
                    model.viewSpace.presentation === "composite"
                      ? ArrowRight01Icon
                      : ArrowDown01Icon
                  }
                  label={
                    model.viewSpace.presentation === "composite"
                      ? t("spaces.expandView")
                      : t("spaces.compactView")
                  }
                  onClick={() => onToggleViewSpace(model.viewSpace?.id ?? "")}
                />
              )}
              {canAddTab && (
                <RowAction
                  icon={PlusSignIcon}
                  label={t("tabs.newTab")}
                  onClick={onNewTab}
                />
              )}
              {canDelete && (
                <RowAction
                  icon={Delete02Icon}
                  label={t("spaces.deleteSpace")}
                  destructive
                  onClick={onDelete}
                />
              )}
            </div>
          </>
        )}
      </div>

      {model.viewSpace && model.slotCount > 1 && (
        <SpaceLayoutMiniature viewSpace={model.viewSpace} />
      )}

      {expanded && (
        <div
          data-workspace-drop-kind="space"
          data-workspace-view-space-id={`view-${space.id}`}
          className="flex flex-col gap-px py-0.5 pl-10 pr-0.5"
        >
          {model.members.map((tab) => (
            <TabRow
              key={tab.id}
              tab={tab}
              dragging={dragging}
              drop={drop}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onJump={() => onJumpTab(tab.id)}
              onClose={() => onCloseTab(tab.id)}
              member
              slotId={model.memberSlotByKey.get(tab.tabKey) ?? null}
              focused={model.focusedMemberKey === tab.tabKey}
              viewSpaces={viewSpaces}
              onExtract={() => onExtractTabFromSpace?.(tab.id)}
              onMoveToSpace={(viewSpaceId) =>
                onMoveTabToViewSpace?.(tab.id, viewSpaceId)
              }
            />
          ))}
          {model.members.length === 0 && (
            <span className="px-2 py-1 text-[10.5px] text-muted-foreground/50">
              {draggingTabFromOther
                ? t("spaces.dropToMoveHere")
                : t("spaces.noTabs")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SpaceLayoutMiniature({ viewSpace }: { viewSpace: ViewSpace }) {
  const geometry = calculateSpaceGeometry(
    viewSpace.layout,
    viewSpace.focusedSlotId,
    { minSlotSize: 0.08 },
  );
  return (
    <div
      className="relative ml-10 mt-0.5 h-8 overflow-hidden rounded border border-border/50 bg-muted/20"
      aria-hidden
    >
      {geometry.slots.map((slot) => (
        <span
          key={slot.slotId}
          className={cn(
            "absolute border border-border/60 bg-muted/40",
            slot.focused && "border-primary/80 bg-primary/15",
            slot.memberTabKey === null && "border-dashed bg-transparent",
          )}
          style={{
            left: `${slot.rect.x * 100}%`,
            top: `${slot.rect.y * 100}%`,
            width: `${slot.rect.width * 100}%`,
            height: `${slot.rect.height * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

function TabRow({
  tab,
  dragging,
  drop,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onJump,
  onClose,
  member,
  slotId,
  focused,
  viewSpaces,
  onExtract,
  onMoveToSpace,
}: {
  tab: Tab;
  dragging: { kind: "space" | "tab"; id: string | number } | null;
  drop: DropTarget | null;
  onPointerDown: (
    e: React.PointerEvent,
    kind: "space" | "tab",
    id: string | number,
  ) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent, onActivate?: () => void) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onJump: () => void;
  onClose: () => void;
  member: boolean;
  slotId: string | null;
  focused: boolean;
  viewSpaces: readonly ViewSpace[];
  onExtract: () => void;
  onMoveToSpace: (viewSpaceId: string) => void;
}) {
  const { t } = useTranslation();
  const subtitle = subtitleFor(tab);
  const processStatus = useTabProcessStatus(tab);
  const stateLabels = [
    tab.locked ? t("spaces.locked") : null,
    tab.kind === "editor" && tab.dirty ? t("spaces.dirty") : null,
    processStatus.state === "running" ? t("spaces.processRunning") : null,
    processStatus.state === "attention" ? t("spaces.processAttention") : null,
    processStatus.state === "failed" ? t("spaces.processFailed") : null,
    tab.kind === "preview" ||
    (tab.kind === "terminal" && tab.collaboration?.mode === "guest")
      ? t("spaces.ephemeral")
      : null,
  ].filter((label): label is string => label !== null);
  const isDragging = dragging?.kind === "tab" && dragging.id === tab.id;
  const reorderEdge =
    drop?.kind === "tab" && drop.tabId === tab.id ? drop.edge : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative">
          {reorderEdge && <DropLine edge={reorderEdge} />}
          {/* biome-ignore lint/a11y/useSemanticElements: drag row hosts a nested close button, cannot be a <button> */}
          <div
            data-drop="tab"
            data-tab-id={tab.id}
            data-workspace-drop-kind={slotId ? "slot" : undefined}
            data-workspace-view-space-id={tab.spaceId ? `view-${tab.spaceId}` : undefined}
            data-workspace-slot-id={slotId ?? undefined}
            role="button"
            tabIndex={0}
            onPointerDown={(e) => onPointerDown(e, "tab", tab.id)}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => onPointerUp(e, onJump)}
            onPointerCancel={onPointerCancel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onJump();
              }
            }}
            className={cn(
              "group/tab relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-primary/40",
              focused && "bg-primary/10 ring-1 ring-inset ring-primary/35",
              isDragging && "opacity-50",
            )}
          >
            <TabIcon tab={tab} animatedAgent />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[11.5px] leading-tight">
                {labelFor(tab)}
              </span>
              {(subtitle ||
                stateLabels.length > 0 ||
                focused) && (
                <span className="flex min-w-0 items-center gap-1 truncate text-[9.5px] leading-tight text-muted-foreground/55">
                  {subtitle}
                  {stateLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded bg-muted/70 px-1 text-[8.5px] leading-[1.4]"
                    >
                      {label}
                    </span>
                  ))}
                  {focused ? ` · ${t("spaces.focused")}` : ""}
                </span>
              )}
            </span>
            <button
              type="button"
              data-no-drag
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label={t("tabs.closeTab")}
              className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/tab:opacity-70 hover:opacity-100"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
            </button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{labelFor(tab)}</ContextMenuLabel>
        <ContextMenuSeparator />
        {member && (
          <ContextMenuItem onSelect={onExtract}>
            {t("spaces.extractMember")}
          </ContextMenuItem>
        )}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            {t("spaces.moveToSpace")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {viewSpaces.map((viewSpace) => (
              <ContextMenuItem
                key={viewSpace.id}
                onSelect={() => onMoveToSpace(viewSpace.id)}
              >
                {viewSpace.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onClose}>
          {t("tabs.closeTab")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DropLine({ edge }: { edge: Edge }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary",
        edge === "top" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2",
      )}
    />
  );
}

function OverlayChip({
  tab,
  color,
  label,
}: {
  tab?: Tab;
  color?: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-popover px-2 py-1.5 text-xs shadow-lg">
      {tab ? (
        <TabIcon tab={tab} animatedAgent />
      ) : (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="max-w-44 truncate font-medium">{label}</span>
    </div>
  );
}

function RowAction({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: typeof Delete02Icon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerCancel={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors",
        destructive
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
    </button>
  );
}

function SpaceColorPicker({
  space,
  onSetColor,
}: {
  space: SpaceMeta;
  onSetColor: (color: number | undefined) => void;
}) {
  const { t } = useTranslation();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("spaces.color")}
          title={t("spaces.color")}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="flex size-5 items-center justify-center rounded hover:bg-accent"
        >
          <span
            aria-hidden
            className="size-2.5 rounded-full ring-1 ring-black/10 dark:ring-white/15"
            style={{ backgroundColor: accentFor(space) }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-auto p-2"
        onPointerDownOutside={(e) => e.stopPropagation()}
      >
        <fieldset
          className="grid grid-cols-4 gap-1.5"
          aria-label={t("spaces.color")}
        >
          {SPACE_COLORS.map((color, index) => (
            <button
              key={color}
              type="button"
              aria-label={t("spaces.colorOption", { index: index + 1 })}
              title={t("spaces.colorOption", { index: index + 1 })}
              onClick={() => onSetColor(index)}
              className={cn(
                "size-5 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110 dark:ring-white/15",
                space.color === index &&
                  "ring-2 ring-foreground ring-offset-1 ring-offset-popover",
              )}
              style={{ backgroundColor: color }}
            />
          ))}
          <button
            type="button"
            aria-label={t("spaces.resetColor")}
            title={t("spaces.resetColor")}
            onClick={() => onSetColor(undefined)}
            className="size-5 rounded-full border border-border bg-background text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            ×
          </button>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
