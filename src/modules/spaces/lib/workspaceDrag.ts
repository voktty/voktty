import type { TabKey } from "@/modules/tabs/lib/tabIdentity";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  collectLayoutSlots,
  type SlotId,
  type ViewSpace,
  type ViewSpaceId,
} from "./spaceLayout";

export type WorkspaceDragSource =
  | {
      kind: "standalone-tab";
      tabId: number;
      tabKey: TabKey;
    }
  | {
      kind: "space-member";
      tabId: number;
      tabKey: TabKey;
      viewSpaceId: ViewSpaceId;
      slotId: SlotId | null;
    }
  | {
      kind: "file";
      path: string;
      workspaceId?: string;
      workspaceEnv?: WorkspaceEnv;
    }
  | {
      kind: "directory";
      path: string;
      workspaceId?: string;
      workspaceEnv?: WorkspaceEnv;
    };

export type WorkspaceDropTarget =
  | {
      kind: "slot";
      viewSpaceId: ViewSpaceId;
      slotId: SlotId;
    }
  | { kind: "space"; viewSpaceId: ViewSpaceId }
  | { kind: "loose-strip" }
  | { kind: "new-space" };

export type WorkspaceDragState = {
  active: boolean;
  source: WorkspaceDragSource | null;
  target: WorkspaceDropTarget | null;
  pointer: { x: number; y: number } | null;
};

export type WorkspaceDragActivationAxis = "any" | "x" | "y";

const EMPTY_STATE: WorkspaceDragState = {
  active: false,
  source: null,
  target: null,
  pointer: null,
};

let state: WorkspaceDragState = EMPTY_STATE;
const listeners = new Set<() => void>();
let cleanupDocumentListeners: (() => void) | null = null;
let activationAxis: WorkspaceDragActivationAxis = "any";
let targetResolveFrame: number | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function reset(): void {
  if (targetResolveFrame !== null) {
    cancelAnimationFrame(targetResolveFrame);
    targetResolveFrame = null;
  }
  state = EMPTY_STATE;
  activationAxis = "any";
  cleanupDocumentListeners?.();
  cleanupDocumentListeners = null;
  document.body.style.userSelect = "";
  emit();
}

export function shouldActivateWorkspaceDrag(
  axis: WorkspaceDragActivationAxis,
  deltaX: number,
  deltaY: number,
): boolean {
  const x = Math.abs(deltaX);
  const y = Math.abs(deltaY);
  if (axis === "any") return Math.hypot(x, y) >= 4;
  const primary = axis === "x" ? x : y;
  const secondary = axis === "x" ? y : x;
  return primary >= 8 && primary >= secondary * 0.5;
}

function handleCancel(): void {
  if (state.source) reset();
}

function handlePointerMove(event: PointerEvent): void {
  if (!state.source) return;
  const pointer = { x: event.clientX, y: event.clientY };
  if (!state.active) {
    const origin = state.pointer;
    if (
      !origin ||
      !shouldActivateWorkspaceDrag(
        activationAxis,
        pointer.x - origin.x,
        pointer.y - origin.y,
      )
    ) {
      return;
    }
    state = { ...state, active: true, pointer };
    document.body.style.userSelect = "none";
    const target = targetFromPoint(event.clientX, event.clientY);
    state = { ...state, target };
    emit();
    return;
  }
  state = { ...state, pointer };
  const target = targetFromPoint(event.clientX, event.clientY);
  if (state.target !== target) state = { ...state, target };
  emit();
}

function targetFromPoint(x: number, y: number): WorkspaceDropTarget | null {
  const element = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-workspace-drop-kind]");
  if (!element) return null;
  const kind = element.dataset.workspaceDropKind;
  const viewSpaceId = element.dataset.workspaceViewSpaceId as
    | ViewSpaceId
    | undefined;
  const slotId = element.dataset.workspaceSlotId as SlotId | undefined;
  if (kind === "loose-strip") return { kind: "loose-strip" };
  if (kind === "new-space") return { kind: "new-space" };
  if (kind === "space" && viewSpaceId) return { kind: "space", viewSpaceId };
  if (kind === "slot" && viewSpaceId && slotId) {
    return { kind: "slot", viewSpaceId, slotId };
  }
  return null;
}

function installDocumentListeners(): void {
  if (cleanupDocumentListeners) return;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") handleCancel();
  };
  const onBlur = () => handleCancel();
  const onPointerCancel = () => handleCancel();
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("blur", onBlur);
  document.addEventListener("pointercancel", onPointerCancel);
  cleanupDocumentListeners = () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("blur", onBlur);
    document.removeEventListener("pointercancel", onPointerCancel);
  };
}

export function getWorkspaceDragState(): WorkspaceDragState {
  return state;
}

export function subscribeWorkspaceDrag(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function beginWorkspaceDrag(
  source: WorkspaceDragSource,
  pointer: { x: number; y: number },
  options: {
    activationAxis?: WorkspaceDragActivationAxis;
    activateImmediately?: boolean;
  } = {},
): void {
  reset();
  activationAxis = options.activationAxis ?? "any";
  state = {
    active: options.activateImmediately === true,
    source,
    target: null,
    pointer,
  };
  if (state.active) document.body.style.userSelect = "none";
  installDocumentListeners();
  document.addEventListener("pointermove", handlePointerMove, true);
  const previousCleanup = cleanupDocumentListeners;
  cleanupDocumentListeners = () => {
    previousCleanup?.();
    document.removeEventListener("pointermove", handlePointerMove, true);
  };
  emit();
  if (state.active) {
    targetResolveFrame = requestAnimationFrame(() => {
      targetResolveFrame = null;
      if (!state.active || !state.pointer) return;
      const target = targetFromPoint(state.pointer.x, state.pointer.y);
      if (state.target === target) return;
      state = { ...state, target };
      emit();
    });
  }
}

export function updateWorkspaceDragTarget(
  target: WorkspaceDropTarget | null,
): void {
  if (!state.source || !state.active) return;
  if (state.target === target) return;
  state = { ...state, target };
  emit();
}

export function finishWorkspaceDrag(): WorkspaceDragState {
  const finished = state;
  reset();
  return finished;
}

export function cancelWorkspaceDrag(): void {
  reset();
}

export function workspaceDragSourceForTab(
  tabId: number,
  tabKey: TabKey,
  viewSpaces: readonly ViewSpace[],
): WorkspaceDragSource {
  const owner = viewSpaces.find((space) => space.memberOrder.includes(tabKey));
  if (!owner) return { kind: "standalone-tab", tabId, tabKey };
  const slotId =
    collectLayoutSlots(owner.layout).find(
      (slot) => slot.memberTabKey === tabKey,
    )?.id ?? null;
  return {
    kind: "space-member",
    tabId,
    tabKey,
    viewSpaceId: owner.id,
    slotId,
  };
}

export function canExtractWorkspaceDrag(
  source: WorkspaceDragSource | null,
): source is Extract<WorkspaceDragSource, { kind: "space-member" }> {
  return source?.kind === "space-member";
}
