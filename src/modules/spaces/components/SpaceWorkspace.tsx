import type { WorkspaceSurfaceProps } from "@/app/components/WorkspaceSurface";
import { WorkspaceSurface } from "@/app/components/WorkspaceSurface";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { type TranslationParams, useTranslation } from "@/modules/i18n";
import type {
  SlotId,
  ViewSpace,
  WorkspacePlacement,
  WorkspaceRect,
} from "@/modules/spaces";
import {
  Drag01Icon,
  MoreHorizontalIcon,
  PaintBoardIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type Tab, labelFor } from "@/modules/tabs";
import { useCallback, useMemo, useRef } from "react";
import { useTerminalCopilotStore } from "@/modules/terminal/copilot/terminalCopilotStore";
import { useShortcutLabel } from "@/modules/shortcuts/lib/useShortcutLabel";
import {
  beginWorkspaceDrag,
  cancelWorkspaceDrag,
  finishWorkspaceDrag,
  getWorkspaceDragState,
  useSpaces,
  workspaceDragSourceForTab,
  type WorkspaceDragSource,
  type WorkspaceDropTarget,
} from "@/modules/spaces";
import {
  calculateSpaceGeometry,
  type SpaceSplitHandlePlacement,
} from "../lib/spaceGeometry";
import { useSlotTints, WINDOW_TINT_PRESETS } from "../lib/slotTints";
import { WorkspaceDropOverlay } from "./WorkspaceDropOverlay";

type SurfaceProps = Omit<WorkspaceSurfaceProps, "placements">;

export type SpaceWorkspaceProps = SurfaceProps & {
  tabs: Tab[];
  viewSpace?: ViewSpace | null;
  onFocusSlot?: (spaceId: string, slotId: SlotId, tabId: number | null) => void;
  onResizeSplit?: (
    spaceId: string,
    splitId: string,
    pointer: number,
    bounds: WorkspaceRect,
  ) => void;
  onNewTerminalInSlot?: (slotId: SlotId) => void;
  onNewFileInSlot?: (slotId: SlotId) => void;
  onSelectExistingTabInSlot?: (slotId: SlotId) => void;
  onDropInSlot?: (slotId: SlotId, event: React.DragEvent<HTMLElement>) => void;
  viewSpaces?: readonly ViewSpace[];
  onExtractSlot?: (tabId: number) => void;
  onMoveSlotToViewSpace?: (tabId: number, viewSpaceId: string) => void;
  onCloseSlot?: (tabId: number) => void;
  onSwapSlots?: (
    viewSpaceId: string,
    sourceSlotId: SlotId,
    targetSlotId: SlotId,
  ) => void;
  onWorkspaceDrop?: (
    source: WorkspaceDragSource,
    target: WorkspaceDropTarget,
  ) => void;
};

const ROOT_BOUNDS: WorkspaceRect = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

export function SpaceWorkspace({
  tabs,
  viewSpace,
  onFocusSlot,
  onResizeSplit,
  onNewTerminalInSlot,
  onNewFileInSlot,
  onSelectExistingTabInSlot,
  onDropInSlot,
  viewSpaces = [],
  onExtractSlot,
  onMoveSlotToViewSpace,
  onCloseSlot,
  onSwapSlots,
  onWorkspaceDrop,
  ...surfaceProps
}: SpaceWorkspaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const composite = viewSpace?.presentation === "composite";
  const geometry = useMemo(
    () =>
      composite && viewSpace
        ? calculateSpaceGeometry(viewSpace.layout, viewSpace.focusedSlotId)
        : null,
    [composite, viewSpace],
  );
  const tabsByKey = useMemo(
    () => new Map(tabs.map((tab) => [tab.tabKey, tab])),
    [tabs],
  );
  const placements = useMemo<WorkspacePlacement[] | undefined>(() => {
    if (!geometry) return undefined;
    return geometry.slots.flatMap((slot) => {
      const tab = slot.memberTabKey
        ? tabsByKey.get(slot.memberTabKey)
        : undefined;
      return tab
        ? [
            {
              tabId: tab.id,
              slotId: slot.slotId,
              rect: slot.rect,
              focused: slot.focused,
            },
          ]
        : [];
    });
  }, [geometry, tabsByKey]);

  const focusSlot = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!composite || !viewSpace || !onFocusSlot) return;
      const target = event.target as HTMLElement;
      const slot = target.closest<HTMLElement>("[data-space-slot]");
      if (!slot) return;
      const slotId = slot.dataset.spaceSlot as SlotId | undefined;
      if (!slotId) return;
      const tabId = Number(slot.dataset.spaceTab);
      onFocusSlot(viewSpace.id, slotId, Number.isFinite(tabId) ? tabId : null);
    },
    [composite, onFocusSlot, viewSpace],
  );

  const isComposite = Boolean(composite && viewSpace && geometry);
  const slotTints = useSlotTints((s) => s.tints);

  return (
    <div
      ref={rootRef}
      className="relative h-full min-h-0 w-full overflow-hidden"
      onPointerDownCapture={isComposite ? focusSlot : undefined}
    >
      <WorkspaceSurface
        {...surfaceProps}
        tabs={tabs}
        placements={isComposite ? (placements ?? []) : undefined}
      />
      {isComposite && viewSpace && geometry && (
        <>
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
            {geometry.slots.map((slot) => {
              const tintId =
                slotTints[`${viewSpace.id}:${slot.slotId}`] ||
                (slot.memberTabKey ? slotTints[slot.memberTabKey] : null);
              if (!tintId) return null;
              const preset = WINDOW_TINT_PRESETS.find((p) => p.id === tintId);
              if (!preset) return null;
              return (
                <div
                  key={`tint-${slot.slotId}`}
                  className="pointer-events-none absolute transition-colors duration-200"
                  style={{
                    ...rectStyle(slot.rect),
                    backgroundColor: preset.bg,
                    boxShadow: `inset 0 0 0 1px ${preset.border}`,
                  }}
                />
              );
            })}
          </div>
          <WorkspaceDropOverlay
            viewSpace={viewSpace}
            geometry={geometry}
            viewSpaces={viewSpaces}
            tabs={tabs}
          />
          <div className="pointer-events-none absolute inset-0 z-30">
            {geometry.slots
              .filter(
                (slot) =>
                  slot.memberTabKey === null || !tabsByKey.has(slot.memberTabKey),
              )
              .map((slot) => (
                <EmptySpaceSlot
                  key={slot.slotId}
                  slotId={slot.slotId}
                  rect={slot.rect}
                  t={t}
                  onNewTerminal={onNewTerminalInSlot}
                  onNewFile={onNewFileInSlot}
                  onSelectExisting={onSelectExistingTabInSlot}
                  onDrop={onDropInSlot}
                />
              ))}
            {geometry.slots.flatMap((slot) => {
              if (!slot.memberTabKey) return [];
              const tab = tabsByKey.get(slot.memberTabKey);
              if (!tab) return [];
              const otherSlots = geometry.slots
                .filter((s) => s.slotId !== slot.slotId && s.memberTabKey)
                .map((s) => ({
                  slotId: s.slotId,
                  tab: s.memberTabKey ? tabsByKey.get(s.memberTabKey) : undefined,
                }));
              return [
                <OccupiedSpaceSlotActions
                  key={`actions-${slot.slotId}`}
                  tab={tab}
                  slotId={slot.slotId}
                  rect={slot.rect}
                  viewSpace={viewSpace}
                  viewSpaces={viewSpaces}
                  otherSlots={otherSlots}
                  onExtract={onExtractSlot}
                  onMoveToSpace={onMoveSlotToViewSpace}
                  onClose={onCloseSlot}
                  onSwapSlots={onSwapSlots}
                  onWorkspaceDrop={onWorkspaceDrop}
                  t={t}
                />,
              ];
            })}
            {geometry.handles.map((handle) => (
              <SpaceResizeHandle
                key={handle.splitId}
                handle={handle}
                rootRef={rootRef}
                onResize={(pointer) =>
                  onResizeSplit?.(
                    viewSpace.id,
                    handle.splitId,
                    pointer,
                    ROOT_BOUNDS,
                  )
                }
                label={t("spaces.resizeHandle", { id: handle.splitId })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OccupiedSpaceSlotActions({
  tab,
  slotId,
  rect,
  viewSpace,
  viewSpaces,
  otherSlots,
  onExtract,
  onMoveToSpace,
  onClose,
  onSwapSlots,
  onWorkspaceDrop,
  t,
}: {
  tab: Tab;
  slotId: SlotId;
  rect: WorkspaceRect;
  viewSpace: ViewSpace;
  viewSpaces: readonly ViewSpace[];
  otherSlots: readonly { slotId: SlotId; tab?: Tab }[];
  onExtract?: (tabId: number) => void;
  onMoveToSpace?: (tabId: number, viewSpaceId: string) => void;
  onClose?: (tabId: number) => void;
  onSwapSlots?: (
    viewSpaceId: string,
    sourceSlotId: SlotId,
    targetSlotId: SlotId,
  ) => void;
  onWorkspaceDrop?: (
    source: WorkspaceDragSource,
    target: WorkspaceDropTarget,
  ) => void;
  t: (key: string, params?: TranslationParams) => string;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    beginWorkspaceDrag(
      workspaceDragSourceForTab(tab.id, tab.tabKey, viewSpaces),
      { x: e.clientX, y: e.clientY },
      { activationAxis: "any" },
    );
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    if (!st.active) {
      if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < 4) return;
      st.active = true;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const wasDragging = st.active;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    const workspaceState = getWorkspaceDragState();
    if (
      wasDragging &&
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
      return;
    }
    finishWorkspaceDrag();
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    cancelWorkspaceDrag();
  };

  const copilotShortcutLabel = useShortcutLabel("terminal.copilot");

  return (
    <div className="pointer-events-none absolute" style={rectStyle(rect)}>
      <div className="pointer-events-auto absolute right-1 top-1 z-50 flex items-center gap-0.5 rounded border border-border/60 bg-popover/90 p-0.5 shadow-sm backdrop-blur-sm">
        <button
          type="button"
          aria-label={t("spaces.dragReady")}
          title={t("spaces.dragReady")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          className="flex size-4.5 cursor-grab items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
          data-space-slot-drag={slotId}
        >
          <HugeiconsIcon icon={Drag01Icon} size={10} strokeWidth={2} />
        </button>
        <SlotTintPicker
          slotId={slotId}
          viewSpaceId={viewSpace.id}
          tabKey={tab.tabKey}
          t={t}
        />
        {tab.kind === "terminal" && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              useTerminalCopilotStore
                .getState()
                .toggleCopilot(tab.activeLeafId);
            }}
            aria-label={
              copilotShortcutLabel
                ? `${t("terminal.copilot.title")} (${copilotShortcutLabel})`
                : t("terminal.copilot.title")
            }
            title={
              copilotShortcutLabel
                ? `${t("terminal.copilot.title")} (${copilotShortcutLabel})`
                : t("terminal.copilot.title")
            }
            className="flex size-4.5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95 cursor-pointer"
          >
            <HugeiconsIcon
              icon={SparklesIcon}
              size={11}
              strokeWidth={2}
              className="text-primary"
            />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("spaces.slotActions", { id: slotId })}
              className="flex size-4.5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              data-space-slot={slotId}
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} size={11} strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="max-w-[200px] truncate font-medium">
              {labelFor(tab)}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onExtract?.(tab.id)}>
              {t("spaces.extractMember")}
            </DropdownMenuItem>
            {otherSlots.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("spaces.swapPosition")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {otherSlots.map(({ slotId: targetSlotId, tab: targetTab }) => (
                    <DropdownMenuItem
                      key={targetSlotId}
                      onSelect={() =>
                        onSwapSlots
                          ? onSwapSlots(viewSpace.id, slotId, targetSlotId)
                          : (useSpaces.getState().swapViewSpaceSlots(
                              viewSpace.id,
                              slotId,
                              targetSlotId,
                            ),
                            useSpaces.getState().focusViewSpaceSlot(
                              viewSpace.id,
                              targetSlotId,
                            ))
                      }
                    >
                      {targetTab ? labelFor(targetTab) : targetSlotId}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {t("spaces.moveToSpace")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {viewSpaces.map((space) => (
                  <DropdownMenuItem
                    key={space.id}
                    onSelect={() => onMoveToSpace?.(tab.id, space.id)}
                  >
                    {space.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onClose?.(tab.id)}
            >
              {t("tabs.closeTab")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function rectStyle(rect: WorkspaceRect): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

function EmptySpaceSlot({
  slotId,
  rect,
  t,
  onNewTerminal,
  onNewFile,
  onSelectExisting,
  onDrop,
}: {
  slotId: SlotId;
  rect: WorkspaceRect;
  t: (key: string, params?: TranslationParams) => string;
  onNewTerminal?: (slotId: SlotId) => void;
  onNewFile?: (slotId: SlotId) => void;
  onSelectExisting?: (slotId: SlotId) => void;
  onDrop?: (slotId: SlotId, event: React.DragEvent<HTMLElement>) => void;
}) {
  return (
    <section
      aria-label={t("spaces.slot", { id: slotId })}
      className="pointer-events-auto absolute grid place-items-center border border-dashed border-border/70 bg-background/35 p-3 backdrop-blur-[1px]"
      style={rectStyle(rect)}
      data-space-slot={slotId}
      onDragOver={(event) => {
        if (!onDrop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => onDrop?.(slotId, event)}
    >
      <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-lg border border-border/65 bg-popover/90 p-2 shadow-lg">
        <span className="sr-only">
          {t("commandPalette.commands.editorEmptyGroup")}
        </span>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          onClick={() => onNewTerminal?.(slotId)}
        >
          {t("commandPalette.commands.newTerminal")}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          onClick={() => onNewFile?.(slotId)}
        >
          {t("commandPalette.commands.newEditorTab")}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => onSelectExisting?.(slotId)}
        >
          {t("commandPalette.commands.openActiveTabs")}
        </Button>
        <span className="basis-full text-center text-[10px] text-muted-foreground">
          {t("commandPalette.commands.dropPrompt")}
        </span>
      </div>
    </section>
  );
}

function SpaceResizeHandle({
  handle,
  rootRef,
  onResize,
  label,
}: {
  handle: SpaceSplitHandlePlacement;
  rootRef: React.RefObject<HTMLDivElement | null>;
  onResize: (pointer: number) => void;
  label: string;
}) {
  const horizontal = handle.direction === "row";
  const rafRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<number | null>(null);

  const style = horizontal
    ? {
        ...rectStyle(handle.rect),
        width: "10px",
        transform: "translateX(-50%)",
      }
    : {
        ...rectStyle(handle.rect),
        height: "10px",
        transform: "translateY(-50%)",
      };

  const scheduleUpdate = (pointer: number) => {
    pendingPointerRef.current = pointer;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (pendingPointerRef.current !== null) {
        onResize(pendingPointerRef.current);
        pendingPointerRef.current = null;
      }
    });
  };

  const update = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const pointer = horizontal
      ? (event.clientX - bounds.left) / Math.max(bounds.width, 1)
      : (event.clientY - bounds.top) / Math.max(bounds.height, 1);
    scheduleUpdate(pointer);
  };

  const currentPointer = horizontal ? handle.rect.x : handle.rect.y;
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = horizontal
      ? event.key === "ArrowLeft"
        ? -0.02
        : event.key === "ArrowRight"
          ? 0.02
          : 0
      : event.key === "ArrowUp"
        ? -0.02
        : event.key === "ArrowDown"
          ? 0.02
          : 0;
    if (!delta) return;
    event.preventDefault();
    onResize(Math.min(0.99, Math.max(0.01, currentPointer + delta)));
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      className="group/handle pointer-events-auto absolute z-40 flex items-center justify-center bg-transparent outline-none transition-colors"
      style={{ ...style, cursor: horizontal ? "col-resize" : "row-resize" }}
      aria-label={label}
      aria-keyshortcuts={
        horizontal ? "ArrowLeft ArrowRight" : "ArrowUp ArrowDown"
      }
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-valuemin={1}
      aria-valuemax={99}
      aria-valuenow={Math.round(currentPointer * 100)}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 1) return;
        update(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (pendingPointerRef.current !== null) {
          onResize(pendingPointerRef.current);
          pendingPointerRef.current = null;
        }
      }}
    >
      <div
        className={cn(
          "pointer-events-none absolute transition-colors duration-150",
          horizontal
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent group-hover/handle:bg-border/80 group-focus-visible/handle:bg-primary"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent group-hover/handle:bg-border/80 group-focus-visible/handle:bg-primary",
        )}
      />
      <div
        className={cn(
          "pointer-events-none z-10 flex items-center justify-center gap-1 transition-all duration-150",
          horizontal ? "flex-col" : "flex-row",
          "opacity-30 group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100 group-hover/handle:scale-110",
        )}
      >
        <span className="size-[2.5px] rounded-full bg-foreground/60 transition-colors group-hover/handle:bg-primary group-focus-visible/handle:bg-primary" />
        <span className="size-[2.5px] rounded-full bg-foreground/60 transition-colors group-hover/handle:bg-primary group-focus-visible/handle:bg-primary" />
        <span className="size-[2.5px] rounded-full bg-foreground/60 transition-colors group-hover/handle:bg-primary group-focus-visible/handle:bg-primary" />
      </div>
    </div>
  );
}

function SlotTintPicker({
  slotId,
  viewSpaceId,
  tabKey,
  t,
}: {
  slotId: SlotId;
  viewSpaceId: string;
  tabKey: string;
  t: (key: string, params?: TranslationParams) => string;
}) {
  const setTint = useSlotTints((s) => s.setTint);
  const currentTintId = useSlotTints(
    (s) =>
      s.tints[`${viewSpaceId}:${slotId}`] ||
      s.tints[tabKey] ||
      null,
  );
  const activePreset = WINDOW_TINT_PRESETS.find((p) => p.id === currentTintId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("spaces.windowTint")}
          title={t("spaces.windowTint")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
        >
          {activePreset ? (
            <span
              aria-hidden
              className="size-2 rounded-full ring-1 ring-black/10 dark:ring-white/20"
              style={{ backgroundColor: activePreset.dot }}
            />
          ) : (
            <HugeiconsIcon icon={PaintBoardIcon} size={11} strokeWidth={2} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-auto p-1.5 rounded-lg bg-popover/95 backdrop-blur-md border border-border/60 shadow-xl"
        onPointerDownOutside={(e) => e.stopPropagation()}
      >
        <fieldset
          className="grid grid-cols-5 gap-1"
          aria-label={t("spaces.windowTint")}
        >
          {WINDOW_TINT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-label={preset.name}
              title={preset.name}
              onClick={(e) => {
                e.stopPropagation();
                setTint(`${viewSpaceId}:${slotId}`, preset.id);
              }}
              className={cn(
                "size-4 rounded-full ring-1 ring-black/10 transition-transform hover:scale-125 dark:ring-white/20 cursor-pointer",
                currentTintId === preset.id &&
                  "ring-2 ring-foreground ring-offset-1 ring-offset-popover scale-110",
              )}
              style={{ backgroundColor: preset.dot }}
            />
          ))}
          <button
            type="button"
            aria-label={t("spaces.resetWindowTint")}
            title={t("spaces.resetWindowTint")}
            onClick={(e) => {
              e.stopPropagation();
              setTint(`${viewSpaceId}:${slotId}`, null);
              setTint(tabKey, null);
            }}
            className="size-4 rounded-full border border-border bg-background text-[9px] font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer flex items-center justify-center"
          >
            ×
          </button>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

