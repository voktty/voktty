import type { HarnessQuitCapture } from "@/modules/harness/lib/appLifecycle";
import {
  normalizeHarnessSessionViewReport,
  referencedHarnessSessionIds,
  type HarnessSessionViewReport,
} from "@/modules/harness/lib/harnessSessionViews";
import { mergeHarnessWindowWorkspaces } from "@/modules/harness/lib/harnessWindowWorkspace";
import type { Session } from "@/modules/harness/lib/session";
import {
  collectWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "@/modules/harness/lib/workspaceSnapshot";

const MAX_REFERENCES = 256;

export type HarnessWindowViewInput = Omit<
  HarnessQuitCapture,
  "sessions" | "persistencePermit"
> & {
  report: HarnessSessionViewReport;
  removingSessionIds?: readonly string[];
  switchingSessionIds?: readonly string[];
};

type ViewState = Readonly<{
  layout: WorkspaceSnapshot;
  returnTargets: readonly (readonly [string, string])[];
  keptTabIds: readonly string[];
  report: HarnessSessionViewReport;
  removingSessionIds: readonly string[];
  switchingSessionIds: readonly string[];
}>;

export type HarnessWindowViewCohort = Readonly<{
  ownerId: number;
  active: boolean;
  sequence: number;
  state: ViewState;
}>;

export type HarnessWindowViewsSnapshot = Readonly<{
  cohorts: readonly HarnessWindowViewCohort[];
  selectedOwnerId: number | null;
}>;

function validOwner(ownerId: number) {
  if (!Number.isSafeInteger(ownerId) || ownerId < 1)
    throw new TypeError("Invalid Harness window view owner");
}

function bounded(values: readonly unknown[]) {
  if (values.length > MAX_REFERENCES)
    throw new RangeError("Harness window view capacity exceeded");
}

function freezeOwned(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeOwned(child);
  Object.freeze(value);
}

function ownState(input: HarnessWindowViewInput): ViewState {
  bounded(input.tabs);
  bounded(input.projectTerminals);
  if (input.projectReturnMemory.size > MAX_REFERENCES)
    throw new RangeError("Harness window view capacity exceeded");
  mergeHarnessWindowWorkspaces(
    [
      {
        ownerId: 1,
        sessions: [],
        snapshot: {
          tabs: input.tabs,
          sessions: [],
          activeTabId: input.activeTabId,
          projectCwd: input.projectCwd,
          projectTerminals: input.projectTerminals,
        },
      },
    ],
    null,
  );
  const report = normalizeHarnessSessionViewReport(
    input.report,
    MAX_REFERENCES,
  );
  const controls = (ids: readonly string[] = []) => {
    const normalized = normalizeHarnessSessionViewReport({
      referencedSessionIds: ids,
    });
    if (
      normalized.referencedSessionIds.some(
        (id) => !report.referencedSessionIds.includes(id),
      )
    )
      throw new TypeError(
        "Harness view controls must reference reported sessions",
      );
    return normalized.referencedSessionIds;
  };
  const removingSessionIds = controls(input.removingSessionIds);
  const switchingSessionIds = controls(input.switchingSessionIds);
  const layout = collectWorkspaceSnapshot(
    input.tabs,
    [],
    input.activeTabId,
    input.projectCwd,
    new Map(),
    input.projectTerminals,
  );
  const returnTargets = [...input.projectReturnMemory].map(([project, id]) =>
    Object.freeze([project, id] as const),
  );
  const keptTabIds = input.tabs
    .filter((tab) => input.keepTab?.(tab) ?? true)
    .map((tab) => tab.id);
  const state = {
    layout,
    returnTargets,
    keptTabIds,
    report,
    removingSessionIds,
    switchingSessionIds,
  };
  freezeOwned(state);
  return state;
}

function captureCohorts(
  cohorts: readonly HarnessWindowViewCohort[],
  selectedOwnerId: number | null,
  sessions: Session[],
): HarnessQuitCapture & { selectedOwnerId: number | null } {
  const empty: WorkspaceSnapshot = {
    tabs: [],
    sessions: [],
    activeTabId: "",
    projectCwd: "~",
    projectTerminals: [],
  };
  const captures = cohorts.map((cohort) => ({
    ownerId: cohort.ownerId,
    sessions,
    snapshot: cohort.state.layout,
  }));
  const merged = mergeHarnessWindowWorkspaces(
    captures.length
      ? captures
      : [{ ownerId: Number.MAX_SAFE_INTEGER, sessions, snapshot: empty }],
    selectedOwnerId,
  );
  const selected = cohorts.find(
    (cohort) => cohort.active && cohort.ownerId === selectedOwnerId,
  );
  const memory = new Map<string, string>();
  const remember = (cohort: HarnessWindowViewCohort) => {
    for (const [project, id] of cohort.state.returnTargets)
      memory.set(project, id);
  };
  for (const cohort of [...cohorts].sort((a, b) => a.sequence - b.sequence))
    remember(cohort);
  if (selected) remember(selected);
  const kept = new Set(
    cohorts.flatMap((cohort) => [...cohort.state.keptTabIds]),
  );
  return {
    sessions: merged.sessions,
    tabs: merged.snapshot.tabs,
    activeTabId: selected?.state.layout.activeTabId ?? "",
    projectCwd: selected?.state.layout.projectCwd ?? "~",
    projectTerminals: merged.snapshot.projectTerminals,
    projectReturnMemory: memory,
    keepTab: (tab) => kept.has(tab.id),
    selectedOwnerId: selected?.ownerId ?? null,
  };
}

export function captureHarnessWindowSnapshot(
  snapshot: HarnessWindowViewsSnapshot,
  sessions: Session[],
) {
  return captureCohorts(snapshot.cohorts, snapshot.selectedOwnerId, sessions);
}

export function createHarnessWindowViews() {
  const entries = new Map<
    number,
    { token: object; cohort: HarnessWindowViewCohort; key: string }
  >();
  const listeners = new Set<() => void>();
  let selectedOwnerId: number | null = null;
  let sequence = 0;
  let snapshot: HarnessWindowViewsSnapshot = Object.freeze({
    cohorts: Object.freeze([]),
    selectedOwnerId,
  });

  const nextSequence = () => {
    if (sequence === Number.MAX_SAFE_INTEGER)
      throw new RangeError("Harness window view generation exhausted");
    return ++sequence;
  };
  const validate = (ownerId: number, cohort: HarnessWindowViewCohort) => {
    const prospective = [...entries.values()]
      .filter((entry) => entry.cohort.ownerId !== ownerId)
      .map((entry) => entry.cohort);
    prospective.push(cohort);
    bounded(prospective);
    bounded(
      referencedHarnessSessionIds(
        prospective.map((entry) => entry.state.report),
      ),
    );
    captureCohorts(prospective, selectedOwnerId, []);
  };
  const publish = () => {
    snapshot = Object.freeze({
      cohorts: Object.freeze(
        [...entries.values()]
          .map((entry) => entry.cohort)
          .sort((a, b) => a.ownerId - b.ownerId),
      ),
      selectedOwnerId,
    });
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* Observers cannot undo resource admission. */
      }
    }
  };
  const handle = (ownerId: number, token: object) => ({
    update(input: HarnessWindowViewInput) {
      const entry = entries.get(ownerId);
      if (entry?.token !== token || !entry.cohort.active) return;
      const state = ownState(input);
      const key = JSON.stringify(state);
      if (key === entry.key) return;
      const cohort = Object.freeze({
        ...entry.cohort,
        state,
        sequence: nextSequence(),
      });
      validate(ownerId, cohort);
      entries.set(ownerId, { token, cohort, key });
      publish();
    },
    release() {
      const entry = entries.get(ownerId);
      if (entry?.token !== token || !entry.cohort.active) return;
      const state = Object.freeze({
        ...entry.cohort.state,
        report: normalizeHarnessSessionViewReport({
          referencedSessionIds: entry.cohort.state.report.referencedSessionIds,
        }),
        removingSessionIds: Object.freeze([]),
        switchingSessionIds: Object.freeze([]),
      });
      entries.set(ownerId, {
        ...entry,
        cohort: Object.freeze({ ...entry.cohort, active: false, state }),
        key: JSON.stringify(state),
      });
      if (selectedOwnerId === ownerId) selectedOwnerId = null;
      publish();
    },
  });
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    register(ownerId: number, input: HarnessWindowViewInput) {
      validOwner(ownerId);
      const state = ownState(input);
      const cohort = Object.freeze({
        ownerId,
        state,
        active: true,
        sequence: nextSequence(),
      });
      validate(ownerId, cohort);
      const token = {};
      entries.set(ownerId, { token, cohort, key: JSON.stringify(state) });
      publish();
      return handle(ownerId, token);
    },
    select(ownerId: number | null) {
      if (ownerId !== null) validOwner(ownerId);
      const next =
        ownerId !== null && entries.get(ownerId)?.cohort.active
          ? ownerId
          : null;
      if (next === selectedOwnerId) return;
      selectedOwnerId = next;
      publish();
    },
    restore(ownerId: number, cohort: HarnessWindowViewCohort) {
      validOwner(ownerId);
      const previous = entries.get(cohort.ownerId);
      if (
        previous?.cohort !== cohort ||
        cohort.active ||
        (ownerId !== cohort.ownerId && entries.has(ownerId))
      )
        return null;
      const restored = Object.freeze({
        ...cohort,
        ownerId,
        active: true,
        sequence: nextSequence(),
      });
      const token = {};
      entries.delete(cohort.ownerId);
      entries.set(ownerId, {
        token,
        cohort: restored,
        key: JSON.stringify(restored.state),
      });
      publish();
      return handle(ownerId, token);
    },
    retire(cohort: HarnessWindowViewCohort) {
      if (cohort.active || entries.get(cohort.ownerId)?.cohort !== cohort)
        return false;
      entries.delete(cohort.ownerId);
      publish();
      return true;
    },
    capture: (sessions: Session[]) =>
      captureHarnessWindowSnapshot(snapshot, sessions),
    isForeground: (id: string) =>
      snapshot.cohorts.some(
        (cohort) =>
          cohort.active &&
          cohort.state.report.foregroundSessionIds.includes(id),
      ),
    isRemoving: (id: string) =>
      snapshot.cohorts.some(
        (cohort) =>
          cohort.active && cohort.state.removingSessionIds.includes(id),
      ),
    isSwitching: (id: string) =>
      snapshot.cohorts.some(
        (cohort) =>
          cohort.active && cohort.state.switchingSessionIds.includes(id),
      ),
  };
}
