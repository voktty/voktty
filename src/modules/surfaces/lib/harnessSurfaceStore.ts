import { create } from "zustand";
import { coerceCwd } from "./cwd";

export type HarnessSurfaceReport = {
  projectCwd: string | null;
  focusFolder: string | null;
};

type HarnessSurfaceState = {
  reports: Record<number, HarnessSurfaceReport>;
  setProjectCwd: (cwd: unknown, ownerId: number) => void;
  setFocusFolder: (cwd: unknown, ownerId: number) => void;
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
    ownerId: number,
  ) => {
    const next = coerceCwd(cwd);
    if (next === null || !isOwnerId(ownerId)) return;
    set((state) => {
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
  if (isOwnerId(ownerId)) {
    return state.reports[ownerId] ?? EMPTY_REPORT;
  }
  return EMPTY_REPORT;
}

export function removeHarnessSurface(ownerId: number): void {
  useHarnessSurfaceStore.getState().removeOwner(ownerId);
}

export function publishHarnessProject(cwd: unknown, ownerId: number): void {
  useHarnessSurfaceStore.getState().setProjectCwd(cwd, ownerId);
}

export function publishHarnessFocusFolder(cwd: unknown, ownerId: number): void {
  useHarnessSurfaceStore.getState().setFocusFolder(cwd, ownerId);
}
