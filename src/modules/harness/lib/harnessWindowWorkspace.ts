import type {
  EditorPane,
  FilePaneTab,
  LayoutNode,
  WorkspaceTab,
} from "@/modules/harness/lib/layout";
import type { ProjectTerminalDock } from "@/modules/harness/lib/projectTerminal";
import type { Session } from "@/modules/harness/lib/session";
import type {
  WorkspaceSessionStub,
  WorkspaceSnapshot,
} from "@/modules/harness/lib/workspaceSnapshot";

export type HarnessWindowWorkspaceCapture = {
  ownerId: number;
  sessions: readonly Session[];
  snapshot: WorkspaceSnapshot;
};
type ResourceRole = "session" | "tab" | "pane" | "file" | "split";

export class HarnessWorkspaceCollisionError extends Error {
  readonly code = "HARNESS_WORKSPACE_COLLISION";
  constructor() {
    super("Harness workspace collision");
    this.name = "HarnessWorkspaceCollisionError";
  }
}

function invalid(): never {
  throw new TypeError("Invalid Harness workspace capture");
}

function bounded(values: readonly unknown[], maximum: number): void {
  if (!Array.isArray(values)) invalid();
  if (values.length > maximum)
    throw new RangeError("Harness workspace reference limit exceeded");
}

function validOwner(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

function sameStructure(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  const visited = new WeakMap<object, WeakSet<object>>();
  while (pending.length) {
    const pair = pending.pop();
    if (!pair) break;
    const [a, b] = pair;
    if (Object.is(a, b)) continue;
    if (!a || !b || typeof a !== "object" || typeof b !== "object")
      return false;
    const prototype = Object.getPrototypeOf(a);
    if (
      prototype !== Object.getPrototypeOf(b) ||
      (prototype !== Object.prototype &&
        prototype !== Array.prototype &&
        prototype !== null)
    )
      return false;
    if (visited.get(a)?.has(b)) continue;
    const matches = visited.get(a) ?? new WeakSet<object>();
    matches.add(b);
    visited.set(a, matches);
    const keys = Reflect.ownKeys(a);
    if (keys.length !== Reflect.ownKeys(b).length) return false;
    for (const key of keys) {
      if (!Object.getOwnPropertyDescriptor(b, key)) return false;
      pending.push([
        (a as Record<PropertyKey, unknown>)[key],
        (b as Record<PropertyKey, unknown>)[key],
      ]);
    }
  }
  return true;
}

function insert<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.has(key)) {
    if (!sameStructure(map.get(key), value))
      throw new HarnessWorkspaceCollisionError();
  } else map.set(key, value);
}

// Per-view inputs are sanitized already; the legacy union cannot encode exact view mapping.
// Exact project mappings must agree; the cap excludes transcript IDs and selection is presentation-only.
export function mergeHarnessWindowWorkspaces(
  captures: readonly HarnessWindowWorkspaceCapture[],
  selectedOwnerId: number | null,
  maxReferences = 256,
): {
  sessions: Session[];
  snapshot: WorkspaceSnapshot;
  selectedOwnerId: number | null;
} {
  if (!validOwner(maxReferences) || maxReferences > 256)
    throw new RangeError("Invalid Harness workspace reference limit");
  if (selectedOwnerId !== null && !validOwner(selectedOwnerId)) invalid();
  bounded(captures, maxReferences);
  const owners = new Set<number>();
  for (const capture of captures) {
    if (!capture || !validOwner(capture.ownerId) || owners.has(capture.ownerId))
      invalid();
    owners.add(capture.ownerId);
    if (!capture.snapshot) invalid();
    bounded(capture.sessions, maxReferences);
    bounded(capture.snapshot.tabs, maxReferences);
    bounded(capture.snapshot.sessions, maxReferences);
    bounded(capture.snapshot.projectTerminals, maxReferences);
    bounded(capture.snapshot.projectReturnTargets ?? [], maxReferences);
  }

  const references = new Set<string>();
  const definitions = new Map<string, ResourceRole>();
  function reference(id: string, role?: ResourceRole): void {
    if (typeof id !== "string" || id.length > 256 || !/\S/u.test(id)) invalid();
    references.add(id);
    if (references.size > maxReferences)
      throw new RangeError("Harness workspace reference limit exceeded");
    if (role !== undefined) {
      const previous = definitions.get(id);
      if (previous !== undefined && previous !== role)
        throw new HarnessWorkspaceCollisionError();
      definitions.set(id, role);
    }
  }
  const sessions = new Map<string, Session>();
  const stubs = new Map<string, WorkspaceSessionStub>();
  const tabs = new Map<string, WorkspaceTab>();
  const docks = new Map<string, ProjectTerminalDock>();
  const projectDocks = new Map<string, ProjectTerminalDock>();
  const panes = new Map<string, EditorPane>();
  const files = new Map<string, FilePaneTab>();
  const layouts = new Map<string, LayoutNode>();
  const targets = new Map<
    string,
    NonNullable<WorkspaceSnapshot["projectReturnTargets"]>[number]
  >();
  const ordered = [...captures].sort((a, b) => a.ownerId - b.ownerId);
  const selected =
    ordered.find((capture) => capture.ownerId === selectedOwnerId) ??
    ordered[0];

  function inspectPane(pane: EditorPane): void {
    reference(pane.id, "pane");
    reference(pane.activeFileId);
    bounded(pane.files, maxReferences);
    insert(panes, pane.id, pane);
    for (const file of pane.files) {
      reference(file.id, "file");
      insert(files, file.id, file);
      if (file.plan) reference(file.plan.sessionId);
      if (file.sessionChanges) reference(file.sessionChanges.sessionId);
    }
  }

  for (const capture of ordered) {
    for (const session of capture.sessions) {
      reference(session.id, "session");
      insert(sessions, session.id, session);
    }
    const snapshot = capture.snapshot;
    for (const stub of snapshot.sessions) {
      reference(stub.id, "session");
      insert(stubs, stub.id, stub);
    }
    for (const tab of snapshot.tabs) {
      reference(tab.id, "tab");
      reference(tab.focusedId);
      bounded(tab.editorPanes, maxReferences);
      bounded(tab.terminalPanes, maxReferences);
      const nodes = [tab.layout];
      let count = 0;
      while (nodes.length) {
        if (++count > maxReferences)
          throw new RangeError("Harness workspace reference limit exceeded");
        const node = nodes.pop();
        if (!node) break;
        reference(node.id, node.type === "split" ? "split" : undefined);
        insert(layouts, node.id, node);
        if (node.type === "split") {
          bounded(node.children, maxReferences);
          nodes.push(...node.children);
        }
      }
      for (const pane of [...tab.editorPanes, ...tab.terminalPanes])
        inspectPane(pane);
      insert(tabs, tab.id, tab);
    }
    for (const dock of snapshot.projectTerminals) {
      inspectPane(dock.pane);
      insert(docks, dock.pane.id, dock);
      insert(projectDocks, dock.projectPath, dock);
    }
    for (const target of snapshot.projectReturnTargets ?? []) {
      if (target.tabId !== undefined) reference(target.tabId);
      if (target.paneId !== undefined) reference(target.paneId);
      insert(targets, target.projectPath, target);
      if (targets.size > maxReferences)
        throw new RangeError("Harness workspace reference limit exceeded");
    }
    if (snapshot.activeTabId !== "") reference(snapshot.activeTabId);
  }
  return {
    sessions: [...sessions.values()],
    selectedOwnerId: selected?.ownerId ?? null,
    snapshot: {
      tabs: [...tabs.values()],
      sessions: [...stubs.values()],
      activeTabId: selected?.snapshot.activeTabId ?? "",
      projectCwd: selected?.snapshot.projectCwd ?? "~",
      projectTerminals: [...docks.values()],
      ...(ordered.some(
        (capture) => capture.snapshot.projectReturnTargets !== undefined,
      )
        ? { projectReturnTargets: [...targets.values()] }
        : {}),
    },
  };
}
