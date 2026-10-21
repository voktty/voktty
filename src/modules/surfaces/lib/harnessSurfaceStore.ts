import { create } from "zustand";
import { coerceCwd } from "./cwd";

export type HarnessSurfaceReport = {
  projectCwd: string | null;
  focusFolder: string | null;
};

type HarnessSurfaceState = HarnessSurfaceReport & {
  reports: Record<number, HarnessSurfaceReport>;
  setProjectCwd: (cwd: unknown, ownerId?: number) => void;
  setFocusFolder: (cwd: unknown, ownerId?: number) => void;
  removeOwner: (ownerId: number) => void;
};

const EMPTY_REPORT: HarnessSurfaceReport = {
  projectCwd: null,
  focusFolder: null,
};

function isOwnerId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export const useHarnessSurfaceStore = create<HarnessSurfaceState>((set) => {
  const update = (
    field: keyof HarnessSurfaceReport,
    cwd: unknown,
    ownerId?: number,
  ) => {
    const next = coerceCwd(cwd);
    if (next === null || (ownerId !== undefined && !isOwnerId(ownerId))) return;
    set((state) => {
      if (ownerId === undefined) {
        return state[field] === next ? state : { [field]: next };
      }
      const report = state.reports[ownerId] ?? EMPTY_REPORT;
      if (report[field] === next) return state;
      return {
        reports: {
          ...state.reports,
          [ownerId]: { ...report, [field]: next },
        },
      };
    });
  };
  return {
    ...EMPTY_REPORT,
    reports: {},
    setProjectCwd: (cwd, ownerId) => update("projectCwd", cwd, ownerId),
    setFocusFolder: (cwd, ownerId) => update("focusFolder", cwd, ownerId),
    removeOwner: (ownerId) =>
      set((state) => {
        if (!(ownerId in state.reports)) return state;
        const reports = { ...state.reports };
        delete reports[ownerId];
        return { reports };
      }),
  };
});

export function selectHarnessSurface(
  state: HarnessSurfaceState,
  ownerId: number | null | undefined,
): HarnessSurfaceReport {
  if (ownerId !== null && ownerId !== undefined) {
    return state.reports[ownerId] ?? EMPTY_REPORT;
  }
  return state;
}

export function removeHarnessSurface(ownerId: number): void {
  useHarnessSurfaceStore.getState().removeOwner(ownerId);
}

export const HARNESS_CWD_CHANGE_EVENT = "voktty:harness-cwd-change";
export const HARNESS_FOCUS_FOLDER_EVENT = "voktty:harness-focus-folder";

function notifyLegacy(eventName: string, cwd: unknown, ownerId?: number): void {
  const path = coerceCwd(cwd);
  if (
    path === null ||
    (ownerId !== undefined && !isOwnerId(ownerId)) ||
    typeof window === "undefined"
  ) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(eventName, { detail: { cwd: path, ownerId } }),
  );
}

export function publishHarnessProject(cwd: unknown, ownerId?: number): void {
  useHarnessSurfaceStore.getState().setProjectCwd(cwd, ownerId);
  notifyLegacy(HARNESS_CWD_CHANGE_EVENT, cwd, ownerId);
}

export function publishHarnessFocusFolder(
  cwd: unknown,
  ownerId?: number,
): void {
  useHarnessSurfaceStore.getState().setFocusFolder(cwd, ownerId);
  notifyLegacy(HARNESS_FOCUS_FOLDER_EVENT, cwd, ownerId);
}

export function installLegacyHarnessSurfaceEvents(
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  const handle = (field: "setProjectCwd" | "setFocusFolder", event: Event) => {
    const detail = (event as CustomEvent<{ cwd?: unknown; ownerId?: unknown }>)
      .detail;
    if (detail?.ownerId !== undefined && !isOwnerId(detail.ownerId)) return;
    // Incoming events update state directly; republishing would create a loop.
    useHarnessSurfaceStore.getState()[field](detail?.cwd, detail?.ownerId);
  };
  const onCwd = (event: Event) => handle("setProjectCwd", event);
  const onFocus = (event: Event) => handle("setFocusFolder", event);
  target.addEventListener(HARNESS_CWD_CHANGE_EVENT, onCwd);
  target.addEventListener(HARNESS_FOCUS_FOLDER_EVENT, onFocus);
  return () => {
    target.removeEventListener(HARNESS_CWD_CHANGE_EVENT, onCwd);
    target.removeEventListener(HARNESS_FOCUS_FOLDER_EVENT, onFocus);
  };
}
